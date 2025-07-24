import express from 'express';
import Campaign from '../models/Campaign.js';
import Contact from '../models/Contact.js';
import Template from '../models/Template.js';
import Response from '../models/Response.js';
import { scheduleCampaign } from '../services/scheduler.js';
import { handleWhatsAppWebhook, sendWhatsAppTextMessage } from '../services/whatsappService.js';

const router = express.Router();

// Webhook endpoint for n8n workflows
router.post('/webhook/campaign', async (req, res) => {
  try {
    const {
      name,
      templateId,
      contactIds,
      contactTags,
      variables,
      scheduledAt,
      rateLimitPerMinute,
      provider,
      n8nWorkflowId,
      googleCalendarEventId
    } = req.body;

    console.log('Received n8n campaign webhook:', req.body);

    // Validate template exists
    const template = await Template.findById(templateId);
    if (!template) {
      return res.status(400).json({ error: 'Template not found' });
    }

    // Get contacts - either by IDs or by tags
    let contacts = [];

    if (contactIds && contactIds.length > 0) {
      contacts = await Contact.find({
        _id: { $in: contactIds },
        status: 'active',
        optedOut: false
      });
    } else if (contactTags && contactTags.length > 0) {
      contacts = await Contact.find({
        tags: { $in: contactTags },
        status: 'active',
        optedOut: false
      });
    }

    if (contacts.length === 0) {
      return res.status(400).json({ error: 'No valid contacts found' });
    }

    // Create campaign
    const campaign = new Campaign({
      name: name || `Automated Campaign - ${new Date().toISOString()}`,
      templateId,
      contacts: contacts.map(c => c._id),
      variables: new Map(Object.entries(variables || {})),
      scheduledAt: scheduledAt ? new Date(scheduledAt) : new Date(),
      status: 'scheduled',
      provider: 'whatsapp',
      rateLimitPerMinute: rateLimitPerMinute || 1000, // WhatsApp Cloud API default rate limit
      createdBy: 'n8n-automation',
      automatedTrigger: true,
      triggerSource: 'n8n',
      n8nWorkflowId,
      googleCalendarEventId,
      progress: {
        total: contacts.length,
        sent: 0,
        delivered: 0,
        read: 0,
        failed: 0
      }
    });

    await campaign.save();

    // Schedule the campaign
    await scheduleCampaign(campaign);

    const populatedCampaign = await Campaign.findById(campaign._id)
      .populate('templateId', 'name body')
      .populate('contacts', 'name phone');

    res.status(201).json({
      success: true,
      campaign: populatedCampaign,
      message: 'Campaign created and scheduled successfully'
    });

  } catch (error) {
    console.error('Error processing n8n webhook:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Webhook for Google Calendar events
router.post('/webhook/calendar', async (req, res) => {
  try {
    const {
      eventId,
      summary,
      description,
      startTime,
      endTime,
      attendees
    } = req.body;

    console.log('Received calendar webhook:', req.body);

    // Parse campaign details from event description or summary
    // This is where you'd implement your calendar event parsing logic
    const campaignData = parseCalendarEvent({
      summary,
      description,
      startTime,
      attendees
    });

    if (!campaignData) {
      return res.status(400).json({
        error: 'Unable to parse campaign data from calendar event'
      });
    }

    // Create campaign from calendar event
    const campaign = new Campaign({
      ...campaignData,
      scheduledAt: new Date(startTime),
      automatedTrigger: true,
      triggerSource: 'calendar',
      googleCalendarEventId: eventId,
      createdBy: 'calendar-automation'
    });

    await campaign.save();
    await scheduleCampaign(campaign);

    res.status(201).json({
      success: true,
      campaign,
      message: 'Campaign created from calendar event'
    });

  } catch (error) {
    console.error('Error processing calendar webhook:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint for n8n to send automated responses back to WhatsApp
router.post('/send-response', async (req, res) => {
  try {
    const {
      responseId,
      phone,
      message,
      responseType = 'text'
    } = req.body;

    console.log('Received n8n response request:', req.body);

    if (!phone || !message) {
      return res.status(400).json({
        success: false,
        error: 'Phone and message are required'
      });
    }

    // Send the response message via WhatsApp
    const result = await sendWhatsAppTextMessage(phone, message);

    if (result.success) {
      // Update the response record if responseId is provided
      if (responseId) {
        const response = await Response.findById(responseId);
        if (response) {
          response.autoResponseSent = true;
          response.autoResponseMessageId = result.messageId;
          response.n8nResponseSent = true;
          await response.save();
        }
      }

      res.json({
        success: true,
        messageId: result.messageId,
        message: 'Response sent successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }

  } catch (error) {
    console.error('Error sending n8n response:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get responses for a specific campaign
router.get('/responses/:campaignId', async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { page = 1, limit = 50, processed } = req.query;

    const query = { originalCampaignId: campaignId };
    if (processed !== undefined) {
      query.processed = processed === 'true';
    }

    const responses = await Response.find(query)
      .populate('contactId', 'name phone email')
      .populate('originalCampaignId', 'name')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Response.countDocuments(query);

    res.json({
      success: true,
      responses,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page)
    });
  } catch (error) {
    console.error('Error fetching campaign responses:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get all responses with filtering
router.get('/responses', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      responseType, 
      processed, 
      phone,
      campaignId 
    } = req.query;

    const query = {};
    
    if (responseType) query.responseType = responseType;
    if (processed !== undefined) query.processed = processed === 'true';
    if (phone) query.fromPhone = { $regex: phone, $options: 'i' };
    if (campaignId) query.originalCampaignId = campaignId;

    const responses = await Response.find(query)
      .populate('contactId', 'name phone email')
      .populate('originalCampaignId', 'name')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Response.countDocuments(query);

    // Get response statistics
    const stats = await Response.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$responseType',
          count: { $sum: 1 }
        }
      }
    ]);

    const responseStats = {};
    stats.forEach(stat => {
      responseStats[stat._id] = stat.count;
    });

    res.json({
      success: true,
      responses,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      stats: responseStats
    });
  } catch (error) {
    console.error('Error fetching responses:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Helper function to parse calendar events
const parseCalendarEvent = (eventData) => {
  // This is a simple example - you'd implement more sophisticated parsing
  const { summary, description } = eventData;

  try {
    // Look for JSON in description or parse structured format
    if (description) {
      // Try to parse JSON from description
      const jsonMatch = description.match(/\{.*\}/s);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    }

    // Fallback: create basic campaign data
    return {
      name: summary || 'Calendar Campaign',
      // You'd implement logic to determine templateId, contacts, etc.
      // based on your specific requirements
    };
  } catch (error) {
    console.error('Error parsing calendar event:', error);
    return null;
  }
};

// WhatsApp webhook verification endpoint
router.get('/webhook', (req, res) => {
  try {
    console.log('Received webhook verification request:', req.query);

    // Your verify token (should match what you set in Meta Dashboard)
    const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

    // Parse params from the webhook verification request
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // Check if a token and mode were sent
    if (mode && token) {
      // Check the mode and token sent are correct
      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        // Respond with 200 OK and challenge token from the request
        console.log('WEBHOOK_VERIFIED');
        res.status(200).send(challenge);
      } else {
        // Responds with '403 Forbidden' if verify tokens do not match
        console.error('Verification failed. Token mismatch.');
        res.sendStatus(403);
      }
    } else {
      console.error('Missing mode or token');
      res.sendStatus(400);
    }
  } catch (error) {
    console.error('Error in webhook verification:', error);
    res.sendStatus(500);
  }
});

// WhatsApp webhook endpoint for receiving updates
router.post('/webhook', express.json({ verify: (req, res, buf) => { req.rawBody = buf } }), async (req, res) => {
  try {
    console.log('Received webhook event:', JSON.stringify(req.body, null, 2));

    // Verify webhook signature
    const signature = req.headers['x-hub-signature-256'];
    if (!verifyWebhookSignature(req.rawBody, signature)) {
      console.error('Invalid webhook signature');
      return res.sendStatus(401);
    }

    // Handle the webhook event
    await handleWhatsAppWebhook(req.body);

    res.status(200).send('EVENT_RECEIVED');
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.sendStatus(500);
  }
});

// Function to verify webhook signature
function verifyWebhookSignature(payload, signature) {
  try {
    // For now, return true for testing. We'll implement proper verification later
    return true;

    // Proper implementation would look like this:
    // const crypto = require('crypto');
    // const expectedSignature = crypto
    //   .createHmac('sha256', process.env.WHATSAPP_APP_SECRET)
    //   .update(payload)
    //   .digest('hex');
    // return `sha256=${expectedSignature}` === signature;
  } catch (error) {
    console.error('Error verifying webhook signature:', error);
    return false;
  }
}

// Get campaign status (for n8n to check)
router.get('/campaign/:id/status', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    res.json({
      id: campaign._id,
      status: campaign.status,
      progress: campaign.progress,
      scheduledAt: campaign.scheduledAt,
      createdAt: campaign.createdAt
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;