import express from 'express';
import Campaign from '../models/Campaign.js';
import Contact from '../models/Contact.js';
import Message from '../models/Message.js';
import { scheduleCampaign, cancelCampaign, rescheduleCampaign } from '../services/scheduler.js';

const router = express.Router();

// Get all campaigns
router.get('/', async (req, res) => {
  try {
    const campaigns = await Campaign.find()
      .populate('contacts', 'name phone')
      .sort({ createdAt: -1 });

    res.json(campaigns);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get campaign by ID
router.get('/:id', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id)
      .populate('contacts');

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    res.json(campaign);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new campaign
router.post('/', async (req, res) => {
  try {
    const {
      name,
      templateName,
      templateLanguage,
      templateComponents,
      contactIds,
      variables,
      scheduledAt,
      timezone,
      rateLimitPerMinute
    } = req.body;

    // Validate contacts exist
    const contacts = await Contact.find({
      _id: { $in: contactIds },
      status: 'active',
      optedOut: false,
    });

    if (contacts.length === 0) {
      return res.status(400).json({ error: 'No valid contacts found' });
    }

    // Create campaign
    const campaign = new Campaign({
      name,
      templateName,
      templateLanguage,
      templateComponents: templateComponents || [],
      contacts: contacts.map(c => c._id),
      variables: new Map(Object.entries(variables || {})),
      scheduledAt: new Date(scheduledAt),
      timezone: timezone || 'UTC',
      rateLimitPerMinute: rateLimitPerMinute || 60,
      createdBy: 'system', // TODO: Get from auth
      progress: {
        total: contacts.length,
        sent: 0,
        delivered: 0,
        read: 0,
        failed: 0
      }
      // Do NOT set jobId here; let the scheduler assign it uniquely
    });

    await campaign.save();

    // Schedule the campaign
    if (new Date(scheduledAt) > new Date()) {
      await scheduleCampaign(campaign);
    } else {
      // If scheduled time is in the past, schedule immediately
      campaign.scheduledAt = new Date();
      await campaign.save();
      await scheduleCampaign(campaign);
    }

    const populatedCampaign = await Campaign.findById(campaign._id)
      .populate('contacts', 'name phone');

    res.status(201).json(populatedCampaign);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update campaign
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const campaign = await Campaign.findById(id);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Don't allow updates to campaigns that are already sending or completed
    if (['sending', 'completed'].includes(campaign.status)) {
      return res.status(400).json({
        error: 'Cannot update campaign that is sending or completed'
      });
    }

    // If rescheduling
    if (updates.scheduledAt && updates.scheduledAt !== campaign.scheduledAt.toISOString()) {
      await rescheduleCampaign(id, new Date(updates.scheduledAt));
    }

    // Update other fields
    Object.assign(campaign, updates);
    await campaign.save();

    const updatedCampaign = await Campaign.findById(id)
      .populate('contacts', 'name phone');

    res.json(updatedCampaign);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cancel campaign
router.post('/:id/cancel', async (req, res) => {
  try {
    const { id } = req.params;

    await cancelCampaign(id);

    const campaign = await Campaign.findById(id)
      .populate('contacts', 'name phone');

    res.json(campaign);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Pause campaign
router.post('/:id/pause', async (req, res) => {
  try {
    const { id } = req.params;

    const campaign = await Campaign.findById(id);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (campaign.status !== 'sending') {
      return res.status(400).json({ error: 'Can only pause sending campaigns' });
    }

    campaign.status = 'paused';
    await campaign.save();

    res.json(campaign);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Resume campaign
router.post('/:id/resume', async (req, res) => {
  try {
    const { id } = req.params;

    const campaign = await Campaign.findById(id);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (campaign.status !== 'paused') {
      return res.status(400).json({ error: 'Can only resume paused campaigns' });
    }

    campaign.status = 'sending';
    await campaign.save();

    res.json(campaign);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get campaign messages
router.get('/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 50, status } = req.query;

    const query = { campaignId: id };
    if (status) {
      query.status = status;
    }

    const messages = await Message.find(query)
      .populate('contactId', 'name phone')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Message.countDocuments(query);

    res.json({
      messages,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete campaign
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const campaign = await Campaign.findById(id);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Cancel if scheduled
    if (campaign.status === 'scheduled' && campaign.jobId) {
      await cancelCampaign(id);
    }

    // Delete associated messages
    await Message.deleteMany({ campaignId: id });

    // Delete campaign
    await Campaign.findByIdAndDelete(id);

    res.json({ message: 'Campaign deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;