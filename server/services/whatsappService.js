import axios from 'axios';
import Contact from '../models/Contact.js';
import Template from '../models/Template.js';
import Message from '../models/Message.js';
import Campaign from '../models/Campaign.js';

const WHATSAPP_API_URL = 'https://graph.facebook.com/v18.0';
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

export const sendCampaignMessages = async (campaign, io) => {
  try {
    // Get template
    const template = await Template.findById(campaign.templateId);
    if (!template) {
      throw new Error('Template not found');
    }

    // Get contacts
    const contacts = await Contact.find({
      _id: { $in: campaign.contacts },
      status: 'active',
      optedOut: false
    });

    if (contacts.length === 0) {
      throw new Error('No active contacts found');
    }

    // Update campaign progress
    campaign.progress.total = contacts.length;
    await campaign.save();

    // Send messages with rate limiting
    // Meta's default rate limit is 80 messages per second
    const rateLimitPerMinute = campaign.rateLimitPerMinute || 1000;
    const delayBetweenMessages = (60 * 1000) / rateLimitPerMinute;

    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];

      try {
        // Create message record
        const messageContent = replaceVariables(template.body, campaign.variables, contact);

        const message = new Message({
          campaignId: campaign._id,
          contactId: contact._id,
          templateId: template._id,
          content: messageContent,
          status: 'pending',
          provider: 'meta'
        });

        await message.save();

        // Send WhatsApp message
        const whatsappResponse = await sendWhatsAppMessage(contact.phone, messageContent, template);

        if (whatsappResponse.success) {
          message.status = 'sent';
          message.providerMessageId = whatsappResponse.messageId;
          message.sentAt = new Date();
          campaign.progress.sent++;
        } else {
          message.status = 'failed';
          message.errorMessage = whatsappResponse.error;
          campaign.progress.failed++;
        }

        await message.save();
        await campaign.save();

        // Emit progress update
        io.emit('campaign-progress-update', {
          campaignId: campaign._id,
          progress: campaign.progress,
          currentContact: i + 1,
          totalContacts: contacts.length
        });

        // Rate limiting delay
        if (i < contacts.length - 1) {
          await new Promise(resolve => setTimeout(resolve, delayBetweenMessages));
        }

      } catch (error) {
        console.error(`Error sending message to ${contact.phone}:`, error);

        const message = await Message.findOne({
          campaignId: campaign._id,
          contactId: contact._id
        });

        if (message) {
          message.status = 'failed';
          message.errorMessage = error.message;
          await message.save();
        }

        campaign.progress.failed++;
        await campaign.save();
      }
    }

    // Mark campaign as completed
    campaign.status = 'completed';
    await campaign.save();

    // Emit completion
    io.emit('campaign-completed', {
      campaignId: campaign._id,
      progress: campaign.progress
    });

    console.log(`Campaign ${campaign._id} completed. Sent: ${campaign.progress.sent}, Failed: ${campaign.progress.failed}`);

  } catch (error) {
    console.error('Error in sendCampaignMessages:', error);

    campaign.status = 'failed';
    await campaign.save();

    throw error;
  }
};

const replaceVariables = (template, variables, contact) => {
  let message = template;

  // Replace campaign variables
  for (const [key, value] of variables) {
    const regex = new RegExp(`{{${key}}}`, 'g');
    message = message.replace(regex, value);
  }

  // Replace contact-specific variables
  message = message.replace(/{{name}}/g, contact.name);
  message = message.replace(/{{phone}}/g, contact.phone);
  message = message.replace(/{{email}}/g, contact.email || '');

  // Replace metadata variables
  for (const [key, value] of contact.metadata) {
    const regex = new RegExp(`{{${key}}}`, 'g');
    message = message.replace(regex, value);
  }

  return message;
};

// Webhook handler for message status updates
export const handleWhatsAppWebhook = async (webhookData) => {
  try {
    console.log('Processing WhatsApp webhook data:', JSON.stringify(webhookData, null, 2));
    const { entry } = webhookData;

    for (const entryItem of entry) {
      const { changes } = entryItem;

      for (const change of changes) {
        console.log('Processing webhook change:', JSON.stringify(change, null, 2));

        if (change.field === 'messages') {
          const { statuses, messages } = change.value;

          // Handle message statuses (delivery, read, etc.)
          if (statuses) {
            for (const status of statuses) {
              console.log('Processing message status:', JSON.stringify(status, null, 2));
              await updateMessageStatus(status);
            }
          }

          // Handle incoming messages (replies)
          if (messages) {
            for (const message of messages) {
              console.log('Received incoming message:', JSON.stringify(message, null, 2));
              // You can implement handling for incoming messages here if needed
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Error handling WhatsApp webhook:', error);
    throw error; // Rethrow to be handled by the route error handler
  }
};

const updateMessageStatus = async (statusUpdate) => {
  try {
    console.log('Updating message status:', JSON.stringify(statusUpdate, null, 2));
    const { id: whatsappMessageId, status, timestamp, errors } = statusUpdate;

    const message = await Message.findOne({ providerMessageId: whatsappMessageId });
    if (!message) {
      console.log(`Message not found for WhatsApp ID: ${whatsappMessageId}`);
      return;
    }

    const campaign = await Campaign.findById(message.campaignId);
    if (!campaign) {
      console.log(`Campaign not found for message: ${message._id}`);
      return;
    }

    // Update message status
    const oldStatus = message.status;
    message.status = status;

    // Handle different status types
    switch (status) {
      case 'sent':
        if (!message.sentAt) {
          message.sentAt = new Date(timestamp * 1000);
        }
        break;
      case 'delivered':
        if (!message.deliveredAt) {
          message.deliveredAt = new Date(timestamp * 1000);
        }
        break;
      case 'read':
        if (!message.readAt) {
          message.readAt = new Date(timestamp * 1000);
        }
        break;
      case 'failed':
        message.errorMessage = errors?.[0]?.message || 'Message delivery failed';
        // Update campaign stats
        campaign.progress.failed++;
        campaign.progress.sent--;
        break;
    }

    console.log(`Message ${message._id} status updated: ${oldStatus} -> ${status}`);
    await message.save();

    if (status === 'failed') {
      await campaign.save();
    }
  } catch (error) {
    console.error('Error updating message status:', error);
    throw error;
  }
};
// Function to format phone number for WhatsApp API
const formatPhoneNumber = (phone) => {
  // Remove any non-digit characters
  let cleaned = phone.replace(/\D/g, '');

  // If number doesn't start with '+', add it
  if (!cleaned.startsWith('91')) {
    cleaned = '91' + cleaned;
  }

  return cleaned;
};

// Function to send WhatsApp message using Meta's Cloud API
const sendWhatsAppMessage = async (phone, message, template) => {
  try {
    const formattedPhone = formatPhoneNumber(phone);
    console.log(`Attempting to send WhatsApp message to ${formattedPhone} (original: ${phone})`);

    // Prepare the request payload for template message
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: formattedPhone,
      type: 'template',
      template: {
        name: template?.whatsappTemplateName || 'hello_world',
        language: {
          code: template?.language?.toLowerCase() || 'en'
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: message
              }
            ]
          }
        ]
      }
    };

    console.log('Request payload:', JSON.stringify(payload, null, 2));

    const response = await axios.post(
      `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('WhatsApp API Response:', JSON.stringify(response.data, null, 2));

    if (!response.data.messages || !response.data.messages[0]) {
      throw new Error('Invalid response format from WhatsApp API');
    }

    return {
      success: true,
      messageId: response.data.messages[0].id
    };
  } catch (error) {
    console.error('Error sending WhatsApp message:');
    console.error('Error details:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message
    });
    console.error('Environment check:', {
      apiUrl: WHATSAPP_API_URL,
      phoneNumberId: PHONE_NUMBER_ID,
      hasAccessToken: !!ACCESS_TOKEN
    });

    return {
      success: false,
      error: error.response?.data?.error?.message || error.message
    };
  }
};
