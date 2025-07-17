import axios from 'axios';
import Contact from '../models/Contact.js';
import Message from '../models/Message.js';
import Campaign from '../models/Campaign.js';
import Response from '../models/Response.js';
import { 
  notifyBroadcastCompleted, 
  notifyBroadcastFailed, 
  notifyBroadcastStarted,
  notifyMessageFailed,
  notifyIncomingResponse
} from './notificationService.js';
import axios from 'axios';

const WHATSAPP_API_URL = 'https://graph.facebook.com/v23.0';
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

// Add logging for debugging
console.log('WhatsApp Service Configuration:');
console.log('API URL:', WHATSAPP_API_URL);
console.log('Phone Number ID:', PHONE_NUMBER_ID);
console.log('Access Token Length:', ACCESS_TOKEN?.length);

export const sendCampaignMessages = async (campaign, io) => {
  try {
    console.log('Starting campaign message sending for campaign:', campaign._id);
    console.log('Campaign data:', {
      templateName: campaign.templateName,
      templateLanguage: campaign.templateLanguage,
      templateComponents: campaign.templateComponents
    });

    // Fetch template details to validate components
    const templateResponse = await fetchLiveWhatsAppTemplates();
    if (!templateResponse.success) {
      throw new Error(`Failed to fetch templates: ${templateResponse.error}`);
    }
    const template = templateResponse.templates.find(t => t.name === campaign.templateName);
    if (!template) {
      throw new Error(`Template ${campaign.templateName} not found or not approved`);
    }
    console.log(`Template details for ${campaign.templateName}:`, JSON.stringify(template, null, 2));

    // Get contacts
    const contacts = await Contact.find({
      _id: { $in: campaign.contacts },
      status: 'active',
      optedOut: false
    });

    console.log(`Found ${contacts.length} active contacts for campaign`);

    if (contacts.length === 0) {
      throw new Error('No active contacts found');
    }

    // Update campaign progress
    campaign.progress.total = contacts.length;
    await campaign.save();

    // Update campaign status to sending
    campaign.status = 'sending';
    await campaign.save();

    // Notify that broadcast has started
    await notifyBroadcastStarted('system', campaign, io);

    // Emit status update
    io.emit('campaign-status-update', {
      campaignId: campaign._id,
      status: 'sending',
      progress: campaign.progress
    });

    const rateLimitPerMinute = campaign.rateLimitPerMinute || 1000;
    const delayBetweenMessages = (60 * 1000) / rateLimitPerMinute;

    console.log(`Processing ${contacts.length} contacts with ${delayBetweenMessages}ms delay between messages`);

    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      console.log(`Processing contact ${i + 1}/${contacts.length}: ${contact.name} (${contact.phone})`);

      let templatePayload = {};
      try {
        const formattedPhone = formatPhoneNumber(contact.phone);
        console.log(`Formatted phone: ${contact.phone} -> ${formattedPhone}`);

        // Build WhatsApp template payload
        templatePayload = {
          messaging_product: 'whatsapp',
          to: formattedPhone,
          type: 'template',
          template: {
            name: campaign.templateName,
            language: {
              code: campaign.templateLanguage || 'en'
            }
          }
        };

        // Only add components if they exist and are not empty
        if (campaign.templateComponents && campaign.templateComponents.length > 0) {
          const sanitizedComponents = campaign.templateComponents.map(component => {
            // Handle HEADER component
            if (component.type === 'HEADER') {
              const templateHeader = template.components.find(c => c.type === 'HEADER');
              if (!templateHeader || campaign.templateName === 'hello_world') {
                return { type: 'header' }; // Static header
              }
              if (templateHeader.format === 'TEXT' && templateHeader.text?.includes('{{')) {
                return {
                  type: 'header',
                  parameters: [{ type: 'text', text: component.text || '' }]
                };
              }
              if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(templateHeader.format)) {
                return {
                  type: 'header',
                  parameters: [{ type: templateHeader.format.toLowerCase(), [templateHeader.format.toLowerCase()]: component.mediaId || '' }]
                };
              }
              return { type: 'header' };
            }

            // Handle BODY component
            if (component.type === 'BODY' && component.text) {
              const templateBody = template.components.find(c => c.type === 'BODY');
              if (!templateBody || campaign.templateName === 'hello_world') {
                return { type: 'body' }; // Static body
              }
              const variables = extractVariablesFromComponents([templateBody]);
              if (variables.length > 0) {
                return {
                  type: 'body',
                  parameters: variables.map((_, index) => ({
                    type: 'text',
                    text: component.text || ''
                  }))
                };
              }
              return { type: 'body' };
            }

            // Handle BUTTONS component
            if (component.type === 'BUTTONS') {
              const templateButtons = template.components.find(c => c.type === 'BUTTONS');
              if (templateButtons?.buttons?.length > 0) {
                return templateButtons.buttons.map((button, index) => ({
                  type: 'button',
                  sub_type: 'quick_reply',
                  index: index,
                  parameters: [
                    {
                      type: 'payload',
                      payload: button.text
                    }
                  ]
                }));
              }
            }

            // Omit FOOTER
            if (component.type === 'FOOTER') {
              return null;
            }
            return component;
          }).flat().filter(Boolean);
          templatePayload.template.components = sanitizedComponents;
        }

        console.log('Sending WhatsApp message with payload:', JSON.stringify(templatePayload, null, 2));

        // Send WhatsApp template message
        const response = await axios.post(
          `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
          templatePayload,
          {
            headers: {
              'Authorization': `Bearer ${ACCESS_TOKEN}`,
              'Content-Type': 'application/json'
            }
          }
        );

        console.log('✅ WhatsApp API Success Response:', JSON.stringify(response.data, null, 2));

        // Create message record
        const message = new Message({
          campaignId: campaign._id,
          contactId: contact._id,
          content: JSON.stringify(templatePayload),
          status: 'sent',
          whatsappMessageId: response.data.messages?.[0]?.id || null,
          sentAt: new Date()
        });
        await message.save();

        // Update campaign progress
        campaign.progress.sent++;
        await campaign.save();

        // Emit status update
        if (io) {
          io.emit('campaign-progress-update', {
            campaignId: campaign._id,
            progress: campaign.progress
          });
        }

      } catch (err) {
        console.error('❌ Error sending message to contact:', contact.phone);
        if (err.response) {
          console.error('WhatsApp API Error Response:', JSON.stringify(err.response.data, null, 2));
          console.error('Status:', err.response.status);
          console.error('Headers:', err.response.headers);
        } else {
          console.error('Error details:', err.message);
        }

        // Handle individual message error
        const message = new Message({
          campaignId: campaign._id,
          contactId: contact._id,
          content: JSON.stringify(templatePayload || {}),
          status: 'failed',
          errorMessage: err.response?.data?.error?.message || err.message,
          sentAt: new Date()
        });
        await message.save();
        campaign.progress.failed++;
        await campaign.save();

        // Notify about message failure
        await notifyMessageFailed('system', message, contact, campaign, err.response?.data?.error?.message || err.message, io);

        // Emit status update for failed message
        if (io) {
          io.emit('campaign-progress-update', {
            campaignId: campaign._id,
            progress: campaign.progress
          });
        }
      }

      // Rate limiting
      if (i < contacts.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayBetweenMessages));
      }
    }

    // Mark campaign as completed
    campaign.status = 'completed';
    await campaign.save();

    // Notify that broadcast has completed
    await notifyBroadcastCompleted('system', campaign, io);

    // Emit completion status
    if (io) {
      io.emit('campaign-status-update', {
        campaignId: campaign._id,
        status: 'completed',
        progress: campaign.progress
      });

      // Emit dashboard update
      io.emit('dashboard-update', {
        type: 'campaign',
        data: { campaignId: campaign._id, status: 'completed' }
      });
    }

    console.log(`✅ Campaign ${campaign._id} completed. Sent: ${campaign.progress.sent}, Failed: ${campaign.progress.failed}`);

  } catch (error) {
    console.error('Error sending campaign messages:', error);
    campaign.status = 'failed';
    await campaign.save();

    // Notify about broadcast failure
    await notifyBroadcastFailed('system', campaign, error.message, io);

    if (io) {
      io.emit('campaign-status-update', {
        campaignId: campaign._id,
        status: 'failed',
        error: error.message
      });
    }

    throw error;
  }
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
              await handleIncomingMessage(message);
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

// Enhanced function to handle incoming messages and responses
const handleIncomingMessage = async (messageData) => {
  try {
    console.log('Processing incoming message:', JSON.stringify(messageData, null, 2));
    
    const { id: whatsappMessageId, from, type, timestamp } = messageData;
    
    // Find or create contact
    let contact = await Contact.findOne({ phone: from });
    if (!contact) {
      // Create new contact from incoming message
      contact = new Contact({
        name: `Contact ${from}`,
        phone: from,
        status: 'active'
      });
      await contact.save();
      console.log(`Created new contact for ${from}`);
    }
    
    let responseContent = '';
    let responseType = type;
    let buttonPayload = null;
    let buttonText = null;
    
    // Extract response content based on message type
    switch (type) {
      case 'text':
        responseContent = messageData.text?.body || '';
        break;
        
      case 'button':
        responseContent = messageData.button?.text || '';
        buttonPayload = messageData.button?.payload || '';
        buttonText = messageData.button?.text || '';
        responseType = 'button';
        break;
        
      case 'interactive':
        if (messageData.interactive?.type === 'button_reply') {
          responseContent = messageData.interactive.button_reply.title || '';
          buttonPayload = messageData.interactive.button_reply.id || '';
          buttonText = messageData.interactive.button_reply.title || '';
          responseType = 'button';
        } else if (messageData.interactive?.type === 'list_reply') {
          responseContent = messageData.interactive.list_reply.title || '';
          buttonPayload = messageData.interactive.list_reply.id || '';
          responseType = 'interactive';
        }
        break;
        
      case 'image':
      case 'video':
      case 'audio':
      case 'document':
        responseContent = messageData[type]?.caption || `[${type.toUpperCase()}]`;
        responseType = 'media';
        break;
        
      default:
        responseContent = `[${type.toUpperCase()} MESSAGE]`;
        console.log(`Unhandled message type: ${type}`);
    }
    
    // Try to find the original campaign/message this is responding to
    const originalContext = await findOriginalContext(contact._id);
    
    // Create response record
    const response = new Response({
      whatsappMessageId,
      fromPhone: from,
      responseType,
      responseContent,
      contactId: contact._id,
      originalCampaignId: originalContext?.campaignId || null,
      originalMessageId: originalContext?.messageId || null,
      buttonPayload,
      buttonText,
      rawWebhookData: messageData
    });
    
    await response.save();
    console.log(`✅ Response saved: ${response._id}`);
    
    // Trigger n8n workflow for automated response
    await triggerN8nResponseWorkflow(response, contact, originalContext);
    
    // Create notification for new response
    await notifyIncomingResponse('system', response, contact, originalContext?.campaign);
    
    return response;
    
  } catch (error) {
    console.error('Error handling incoming message:', error);
    throw error;
  }
};

// Function to find the original campaign/message context
const findOriginalContext = async (contactId) => {
  try {
    // Find the most recent message sent to this contact
    const recentMessage = await Message.findOne({
      contactId,
      status: { $in: ['sent', 'delivered', 'read'] }
    })
    .sort({ sentAt: -1 })
    .populate('campaignId');
    
    if (recentMessage) {
      return {
        messageId: recentMessage._id,
        campaignId: recentMessage.campaignId._id,
        campaign: recentMessage.campaignId
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error finding original context:', error);
    return null;
  }
};

// Function to trigger n8n workflow for automated responses
const triggerN8nResponseWorkflow = async (response, contact, originalContext) => {
  try {
    const n8nWebhookUrl = process.env.N8N_RESPONSE_WEBHOOK_URL;
    
    if (!n8nWebhookUrl) {
      console.log('N8N_RESPONSE_WEBHOOK_URL not configured, skipping n8n trigger');
      return;
    }
    
    // Prepare payload for n8n
    const n8nPayload = {
      // Response details
      responseId: response._id,
      responseType: response.responseType,
      responseContent: response.responseContent,
      buttonPayload: response.buttonPayload,
      buttonText: response.buttonText,
      
      // Contact details
      contact: {
        id: contact._id,
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        tags: contact.tags,
        metadata: Object.fromEntries(contact.metadata || new Map())
      },
      
      // Original context
      originalContext: originalContext ? {
        campaignId: originalContext.campaignId,
        campaignName: originalContext.campaign?.name,
        messageId: originalContext.messageId
      } : null,
      
      // Timestamp
      timestamp: new Date().toISOString(),
      
      // WhatsApp details
      whatsapp: {
        messageId: response.whatsappMessageId,
        fromPhone: response.fromPhone
      }
    };
    
    console.log('Triggering n8n workflow with payload:', JSON.stringify(n8nPayload, null, 2));
    
    // Send to n8n webhook
    const n8nResponse = await axios.post(n8nWebhookUrl, n8nPayload, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000 // 10 second timeout
    });
    
    console.log('✅ n8n workflow triggered successfully:', n8nResponse.status);
    
    // Update response record
    response.n8nWorkflowTriggered = true;
    response.processedAt = new Date();
    await response.save();
    
    return n8nResponse.data;
    
  } catch (error) {
    console.error('❌ Error triggering n8n workflow:', error.message);
    
    // Log the error but don't throw - we don't want to break the webhook processing
    if (error.response) {
      console.error('n8n Response Status:', error.response.status);
      console.error('n8n Response Data:', error.response.data);
    }
    
    return null;
  }
};

const updateMessageStatus = async (statusUpdate) => {
  try {
    console.log('Updating message status:', JSON.stringify(statusUpdate, null, 2));
    const { id: whatsappMessageId, status, timestamp, errors } = statusUpdate;

    const message = await Message.findOne({ whatsappMessageId: whatsappMessageId });
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

  // If number doesn't start with country code, add India's code (91)
  if (!cleaned.startsWith('91') && cleaned.length === 10) {
    cleaned = '91' + cleaned;
  }

  console.log(`Phone formatting: ${phone} -> ${cleaned}`);
  return cleaned;
};

// Function to send simple text message via WhatsApp Cloud API
export const sendWhatsAppTextMessage = async (phone, message) => {
  try {
    const formattedPhone = formatPhoneNumber(phone);
    console.log(`Sending simple text message to ${formattedPhone} (original: ${phone})`);

    // Simple text message payload
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: formattedPhone,
      type: 'text',
      text: {
        body: message
      }
    };

    console.log('Text message payload:', JSON.stringify(payload, null, 2));

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
    console.error('Error sending WhatsApp text message:');
    console.error('Error details:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message
    });

    // Log environment details for debugging
    console.error('Environment check:', {
      apiUrl: WHATSAPP_API_URL,
      phoneNumberId: PHONE_NUMBER_ID,
      hasAccessToken: !!ACCESS_TOKEN,
      accessTokenLength: ACCESS_TOKEN?.length
    });

    return {
      success: false,
      error: error.response?.data?.error?.message || error.message
    };
  }
};

// Function to send WhatsApp template message
const sendWhatsAppTemplateMessage = async (phone, template, campaignVariables, contact) => {
  try {
    const formattedPhone = formatPhoneNumber(phone);
    console.log(`Sending WhatsApp template "${template.whatsappTemplateName}" to ${formattedPhone} (original: ${phone})`);

    // Build template payload
    const templatePayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: formattedPhone,
      type: 'template',
      template: {
        name: template.whatsappTemplateName,
        language: {
          code: template.whatsappConfig?.language || 'en'
        }
      }
    };

    // Add components if template has dynamic content or buttons
    const components = [];

    // Handle HEADER component
    const templateHeader = template.components.find(c => c.type === 'HEADER');
    if (templateHeader) {
      if (templateHeader.format === 'TEXT' && templateHeader.text?.includes('{{')) {
        components.push({
          type: 'header',
          parameters: [{ type: 'text', text: templateHeader.text || '' }]
        });
      } else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(templateHeader.format)) {
        components.push({
          type: 'header',
          parameters: [{ type: templateHeader.format.toLowerCase(), [templateHeader.format.toLowerCase()]: '' }]
        });
      } else {
        components.push({ type: 'header' });
      }
    }

    // Handle BODY component
    const bodyVariables = extractTemplateVariables(template.body);
    if (bodyVariables.length > 0) {
      const bodyParameters = bodyVariables.map(variable => {
        let value = '';

        // Try to get value from campaign variables first
        if (campaignVariables && campaignVariables.has(variable)) {
          value = campaignVariables.get(variable);
        }
        // Then try contact-specific variables
        else if (variable === 'name') {
          value = contact.name;
        } else if (variable === 'phone') {
          value = contact.phone;
        } else if (variable === 'email') {
          value = contact.email || '';
        } else if (contact.metadata && contact.metadata.has(variable)) {
          value = contact.metadata.get(variable);
        }

        return {
          type: 'text',
          text: value
        };
      });

      components.push({
        type: 'body',
        parameters: bodyParameters
      });
    } else {
      components.push({ type: 'body' });
    }

    // Handle BUTTONS component
    if (template.whatsappConfig?.hasButtons && template.whatsappConfig.buttons?.length > 0) {
      const buttonComponents = template.whatsappConfig.buttons.map((button, index) => ({
        type: 'button',
        sub_type: 'quick_reply',
        index: index,
        parameters: [
          {
            type: 'payload',
            payload: button.text
          }
        ]
      }));
      components.push(...buttonComponents);
      console.log(`Added ${buttonComponents.length} button components to payload`);
    }

    // Add components to template if any exist
    if (components.length > 0) {
      templatePayload.template.components = components;
    }

    console.log('WhatsApp template payload:', JSON.stringify(templatePayload, null, 2));

    const response = await axios.post(
      `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
      templatePayload,
      {
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('WhatsApp Template API Response:', JSON.stringify(response.data, null, 2));

    if (!response.data.messages || !response.data.messages[0]) {
      throw new Error('Invalid response format from WhatsApp API');
    }

    return {
      success: true,
      messageId: response.data.messages[0].id
    };
  } catch (error) {
    console.error('Error sending WhatsApp template message:');
    console.error('Error details:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message
    });

    return {
      success: false,
      error: error.response?.data?.error?.message || error.message
    };
  }
};

// Function to fetch live templates from Meta WhatsApp Business API
export const fetchLiveWhatsAppTemplates = async () => {
  try {
    const BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;

    if (!BUSINESS_ACCOUNT_ID) {
      throw new Error('WHATSAPP_BUSINESS_ACCOUNT_ID environment variable is required');
    }

    console.log('Fetching live WhatsApp templates from Meta API...');

    const response = await axios.get(
      `${WHATSAPP_API_URL}/${BUSINESS_ACCOUNT_ID}/message_templates`,
      {
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        params: {
          fields: 'name,status,category,language,components,id',
          limit: 100 // Adjust as needed
        }
      }
    );

    console.log('Meta API Response:', JSON.stringify(response.data, null, 2));

    if (!response.data.data) {
      throw new Error('Invalid response format from Meta API');
    }

    // Transform Meta API response to our frontend format
    const templates = response.data.data
      .filter(template => template.status === 'APPROVED') // Only show approved templates
      .map(template => ({
        id: template.id,
        name: template.name,
        status: template.status.toLowerCase(),
        category: template.category,
        language: template.language,
        whatsappTemplateName: template.name,
        components: template.components || [],
        // Extract body text from components
        body: extractBodyFromComponents(template.components),
        // Extract variables from components
        variables: extractVariablesFromComponents(template.components),
        // Check if template has buttons
        whatsappConfig: {
          language: template.language,
          hasButtons: hasButtonComponents(template.components),
          buttons: extractButtonsFromComponents(template.components),
          headerType: getHeaderType(template.components)
        },
        provider: 'whatsapp',
        isLiveTemplate: true // Flag to indicate this is from Meta API
      }));

    console.log(`Successfully fetched ${templates.length} approved templates from Meta API`);
    return {
      success: true,
      templates,
      total: templates.length
    };

  } catch (error) {
    console.error('Error fetching live WhatsApp templates:');
    console.error('Error details:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message
    });

    return {
      success: false,
      error: error.response?.data?.error?.message || error.message,
      templates: []
    };
  }
};

// Helper function to extract body text from template components
const extractBodyFromComponents = (components) => {
  if (!components || !Array.isArray(components)) return '';

  const bodyComponent = components.find(comp => comp.type === 'BODY');
  return bodyComponent?.text || '';
};

// Helper function to extract variables from template components
const extractVariablesFromComponents = (components) => {
  if (!components || !Array.isArray(components)) return [];

  const variables = [];

  components.forEach(component => {
    if (component.text) {
      // Extract {{1}}, {{2}}, etc. from the text
      const matches = component.text.match(/\{\{(\d+)\}\}/g);
      if (matches) {
        matches.forEach(match => {
          const variableNumber = match.replace(/[{}]/g, '');
          if (!variables.find(v => v.name === `param${variableNumber}`)) {
            variables.push({
              name: `param${variableNumber}`,
              type: 'text',
              required: true
            });
          }
        });
      }
    }
  });

  return variables;
};

// Helper function to check if template has button components
const hasButtonComponents = (components) => {
  if (!components || !Array.isArray(components)) return false;
  return components.some(comp => comp.type === 'BUTTONS');
};

// Helper function to extract buttons from components
const extractButtonsFromComponents = (components) => {
  if (!components || !Array.isArray(components)) return [];

  const buttonComponent = components.find(comp => comp.type === 'BUTTONS');
  if (!buttonComponent || !buttonComponent.buttons) return [];

  return buttonComponent.buttons.map(button => ({
    type: button.type === 'QUICK_REPLY' ? 'quick_reply' : 'call_to_action',
    text: button.text,
    payload: button.type === 'QUICK_REPLY' ? button.text : undefined
  }));
};

// Helper function to get header type
const getHeaderType = (components) => {
  if (!components || !Array.isArray(components)) return 'none';

  const headerComponent = components.find(comp => comp.type === 'HEADER');
  if (!headerComponent) return 'none';

  if (headerComponent.format === 'TEXT') return 'text';
  if (headerComponent.format === 'IMAGE') return 'image';
  if (headerComponent.format === 'VIDEO') return 'video';
  if (headerComponent.format === 'DOCUMENT') return 'document';

  return 'none';
};

// Helper function to extract variables from template body
const extractTemplateVariables = (templateBody) => {
  const variableRegex = /{{(\w+)}}/g;
  const variables = [];
  let match;

  while ((match = variableRegex.exec(templateBody)) !== null) {
    if (!variables.includes(match[1])) {
      variables.push(match[1]);
    }
  }

  return variables;
};