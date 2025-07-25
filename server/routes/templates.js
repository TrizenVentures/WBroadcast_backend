import express from 'express';
import Template from '../models/Template.js';
import { fetchLiveWhatsAppTemplates } from '../services/whatsappService.js';

const router = express.Router();

// Get live WhatsApp templates from Meta API
router.get('/whatsapp/live', async (req, res) => {
  try {
    console.log('Fetching live WhatsApp templates...');
    const result = await fetchLiveWhatsAppTemplates();
    
    if (result.success) {
      res.json({
        success: true,
        templates: result.templates,
        total: result.total,
        message: 'Live templates fetched successfully from Meta API'
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
        templates: [],
        message: 'Failed to fetch live templates from Meta API'
      });
    }
  } catch (error) {
    console.error('Error in live templates endpoint:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      templates: [],
      message: 'Internal server error while fetching live templates'
    });
  }
});

// Get all templates
router.get('/', async (req, res) => {
  try {
    const { status, category } = req.query;
    
    const query = {};
    if (status) query.status = status;
    if (category) query.category = category;

    const templates = await Template.find(query).sort({ createdAt: -1 });
    res.json(templates);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get template by ID
router.get('/:id', async (req, res) => {
  try {
    const template = await Template.findById(req.params.id);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    res.json(template);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new template
router.post('/', async (req, res) => {
  try {
    const templateData = req.body;
    
    // Set default provider if not specified
    if (!templateData.provider) {
      templateData.provider = 'whatsapp';
    }
    
    // Initialize whatsappConfig if it's a WhatsApp template
    if (templateData.provider === 'whatsapp' && !templateData.whatsappConfig) {
      templateData.whatsappConfig = {
        language: 'en',
        hasButtons: false,
        buttons: [],
        headerType: 'none'
      };
    }
    
    const template = new Template(templateData);
    await template.save();
    res.status(201).json(template);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update template
router.put('/:id', async (req, res) => {
  try {
    const template = await Template.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    res.json(template);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete template
router.delete('/:id', async (req, res) => {
  try {
    const template = await Template.findByIdAndDelete(req.params.id);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    res.json({ message: 'Template deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

// Test endpoint to verify WhatsApp API connection
router.post('/test-whatsapp', async (req, res) => {
  try {
    const { phone } = req.body;
    
    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
    const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const WHATSAPP_API_URL = 'https://graph.facebook.com/v22.0';

    // Format phone number
    let cleaned = phone.replace(/\D/g, '');
    if (!cleaned.startsWith('91') && cleaned.length === 10) {
      cleaned = '91' + cleaned;
    }

    // Test with hello_world template (exactly like your working curl)
    const payload = {
      messaging_product: 'whatsapp',
      to: cleaned,
      type: 'template',
      template: {
        name: 'hello_world',
        language: {
          code: 'en_US'
        }
      }
    };

    console.log('Testing WhatsApp API with payload:', JSON.stringify(payload, null, 2));
    console.log('Using URL:', `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`);
    console.log('Access Token Length:', ACCESS_TOKEN?.length);

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

    console.log('✅ WhatsApp Test Success:', JSON.stringify(response.data, null, 2));

    res.json({
      success: true,
      message: 'WhatsApp message sent successfully',
      data: response.data,
      payload: payload
    });

  } catch (error) {
    console.error('❌ WhatsApp Test Failed:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Error:', error.message);
    }

    res.status(500).json({
      success: false,
      error: error.response?.data?.error?.message || error.message,
      details: error.response?.data
    });
  }
});
// Helper route to create your specific WhatsApp templates
// You can call this once to set up your templates
router.post('/setup-whatsapp-templates', async (req, res) => {
  try {
    const templates = [
      {
        name: 'Hello World Template',
        body: 'Welcome and congratulations!! This message demonstrates your ability to send a WhatsApp message notification from the Cloud API, hosted by Meta. Thank you for taking the time to test with us.',
        category: 'UTILITY',
        status: 'approved',
        provider: 'whatsapp',
        whatsappTemplateName: 'hello_world',
        whatsappConfig: {
          language: 'en_US',
          hasButtons: false,
          buttons: [],
          headerType: 'none'
        },
        variables: []
      },
      {
        name: 'Test Template with Buttons',
        body: 'Hello, Your appointment with us is scheduled at 6 pm.',
        category: 'MARKETING',
        status: 'approved',
        provider: 'whatsapp',
        whatsappTemplateName: 'test_template',
        whatsappConfig: {
          language: 'en',
          hasButtons: true,
          buttons: [
            {
              type: 'quick_reply',
              text: 'Confirm',
              payload: 'CONFIRM_APPOINTMENT'
            },
            {
              type: 'quick_reply',
              text: 'Cancel',
              payload: 'CANCEL_APPOINTMENT'
            }
          ],
          headerType: 'none'
        },
        variables: []
      }
    ];

    const createdTemplates = [];
    
    for (const templateData of templates) {
      // Check if template already exists
      const existingTemplate = await Template.findOne({ 
        whatsappTemplateName: templateData.whatsappTemplateName 
      });
      
      if (!existingTemplate) {
        const template = new Template(templateData);
        await template.save();
        createdTemplates.push(template);
      } else {
        console.log(`Template ${templateData.whatsappTemplateName} already exists`);
      }
    }

    res.json({
      message: 'WhatsApp templates setup completed',
      created: createdTemplates.length,
      templates: createdTemplates
    });
  } catch (error) {
    console.error('Error setting up WhatsApp templates:', error);
    res.status(500).json({ error: error.message });
  }
});