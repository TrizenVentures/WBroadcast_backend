import express from 'express';
import { authenticate } from '../middleware/auth.js';
import Campaign from '../models/Campaign.js';
import Contact from '../models/Contact.js';
import Message from '../models/Message.js';
import Template from '../models/Template.js';
import Notification from '../models/Notification.js';

const router = express.Router();

// Dashboard Statistics
router.get('/stats', authenticate, async (req, res) => {
  try {
    const userId = req.user._id;

    // Get current period stats
    const totalContacts = await Contact.countDocuments({ status: 'active' });
    const messagesSent = await Message.countDocuments({ status: { $in: ['sent', 'delivered', 'read'] } });
    const activeTemplates = await Template.countDocuments({ status: 'approved' });
    
    // Calculate delivery rate
    const totalMessages = await Message.countDocuments();
    const deliveredMessages = await Message.countDocuments({ 
      status: { $in: ['delivered', 'read'] } 
    });
    const deliveryRate = totalMessages > 0 ? Math.round((deliveredMessages / totalMessages) * 100) : 0;

    // Calculate changes (comparing last 7 days vs previous 7 days)
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    // Current period (last 7 days)
    const currentContacts = await Contact.countDocuments({
      createdAt: { $gte: sevenDaysAgo },
      status: 'active'
    });
    const currentMessages = await Message.countDocuments({
      createdAt: { $gte: sevenDaysAgo },
      status: { $in: ['sent', 'delivered', 'read'] }
    });
    const currentTemplates = await Template.countDocuments({
      createdAt: { $gte: sevenDaysAgo },
      status: 'approved'
    });

    // Previous period (7-14 days ago)
    const previousContacts = await Contact.countDocuments({
      createdAt: { $gte: fourteenDaysAgo, $lt: sevenDaysAgo },
      status: 'active'
    });
    const previousMessages = await Message.countDocuments({
      createdAt: { $gte: fourteenDaysAgo, $lt: sevenDaysAgo },
      status: { $in: ['sent', 'delivered', 'read'] }
    });
    const previousTemplates = await Template.countDocuments({
      createdAt: { $gte: fourteenDaysAgo, $lt: sevenDaysAgo },
      status: 'approved'
    });

    // Calculate percentage changes
    const calculateChange = (current, previous) => {
      if (previous === 0) return current > 0 ? '+100%' : '0%';
      const change = ((current - previous) / previous) * 100;
      return change >= 0 ? `+${Math.round(change)}%` : `${Math.round(change)}%`;
    };

    // Calculate delivery rate change
    const currentDeliveryRate = await calculatePeriodDeliveryRate(sevenDaysAgo, now);
    const previousDeliveryRate = await calculatePeriodDeliveryRate(fourteenDaysAgo, sevenDaysAgo);
    const deliveryRateChange = calculateChange(currentDeliveryRate, previousDeliveryRate);

    res.json({
      totalContacts,
      messagesSent,
      activeTemplates,
      deliveryRate,
      contactsChange: calculateChange(currentContacts, previousContacts),
      messagesSentChange: calculateChange(currentMessages, previousMessages),
      activeTemplatesChange: calculateChange(currentTemplates, previousTemplates),
      deliveryRateChange
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Recent Activity
router.get('/recent-activity', authenticate, async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const userId = req.user._id;

    // Fetch recent activities from various sources
    const activities = [];

    // Recent campaigns
    const recentCampaigns = await Campaign.find()
      .sort({ updatedAt: -1 })
      .limit(5)
      .populate('templateId', 'name');

    recentCampaigns.forEach(campaign => {
      let status = 'info';
      let description = '';

      switch (campaign.status) {
        case 'completed':
          status = 'success';
          description = `Campaign completed. Sent ${campaign.progress.sent}/${campaign.progress.total} messages`;
          break;
        case 'failed':
          status = 'error';
          description = `Campaign failed. ${campaign.progress.failed} messages failed`;
          break;
        case 'sending':
          status = 'pending';
          description = `Campaign in progress. ${campaign.progress.sent}/${campaign.progress.total} messages sent`;
          break;
        case 'scheduled':
          status = 'scheduled';
          description = `Campaign scheduled for ${new Date(campaign.scheduledAt).toLocaleString()}`;
          break;
        default:
          description = `Campaign status: ${campaign.status}`;
      }

      activities.push({
        id: `campaign_${campaign._id}`,
        type: 'broadcast',
        title: `Campaign: ${campaign.name}`,
        description,
        time: campaign.updatedAt,
        status,
        metadata: {
          campaignId: campaign._id
        }
      });
    });

    // Recent templates
    const recentTemplates = await Template.find()
      .sort({ updatedAt: -1 })
      .limit(3);

    recentTemplates.forEach(template => {
      let status = 'info';
      let description = '';

      switch (template.status) {
        case 'approved':
          status = 'success';
          description = 'Template approved and ready to use';
          break;
        case 'rejected':
          status = 'error';
          description = 'Template rejected';
          break;
        case 'pending':
          status = 'pending';
          description = 'Template pending approval';
          break;
        default:
          description = `Template status: ${template.status}`;
      }

      activities.push({
        id: `template_${template._id}`,
        type: 'template',
        title: `Template: ${template.name}`,
        description,
        time: template.updatedAt,
        status,
        metadata: {
          templateId: template._id
        }
      });
    });

    // Recent contacts
    const recentContacts = await Contact.find()
      .sort({ createdAt: -1 })
      .limit(3);

    recentContacts.forEach(contact => {
      activities.push({
        id: `contact_${contact._id}`,
        type: 'contact',
        title: `New Contact: ${contact.name}`,
        description: `Contact added with phone ${contact.phone}`,
        time: contact.createdAt,
        status: 'success',
        metadata: {
          contactId: contact._id
        }
      });
    });

    // Recent failed messages
    const failedMessages = await Message.find({ status: 'failed' })
      .sort({ createdAt: -1 })
      .limit(2)
      .populate('contactId', 'name phone')
      .populate('campaignId', 'name');

    failedMessages.forEach(message => {
      activities.push({
        id: `message_${message._id}`,
        type: 'error',
        title: 'Message Failed',
        description: `Failed to send message to ${message.contactId?.name || 'Unknown'} (${message.contactId?.phone || 'Unknown'})`,
        time: message.createdAt,
        status: 'error',
        metadata: {
          messageId: message._id,
          campaignId: message.campaignId?._id,
          contactId: message.contactId?._id
        }
      });
    });

    // Sort all activities by time and limit
    const sortedActivities = activities
      .sort((a, b) => new Date(b.time) - new Date(a.time))
      .slice(0, parseInt(limit));

    res.json(sortedActivities);
  } catch (error) {
    console.error('Error fetching recent activity:', error);
    res.status(500).json({ error: error.message });
  }
});

// Active Campaigns
router.get('/active-campaigns', authenticate, async (req, res) => {
  try {
    const activeCampaigns = await Campaign.find({
      status: { $in: ['sending', 'scheduled', 'paused'] }
    })
    .sort({ createdAt: -1 })
    .select('name status progress createdAt scheduledAt');

    const formattedCampaigns = activeCampaigns.map(campaign => ({
      _id: campaign._id,
      name: campaign.name,
      status: campaign.status,
      progress: campaign.progress.total > 0 
        ? Math.round((campaign.progress.sent / campaign.progress.total) * 100)
        : 0,
      sent: campaign.progress.sent,
      total: campaign.progress.total,
      createdAt: campaign.createdAt,
      scheduledAt: campaign.scheduledAt
    }));

    res.json(formattedCampaigns);
  } catch (error) {
    console.error('Error fetching active campaigns:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to calculate delivery rate for a specific period
const calculatePeriodDeliveryRate = async (startDate, endDate) => {
  const totalMessages = await Message.countDocuments({
    createdAt: { $gte: startDate, $lt: endDate }
  });
  
  if (totalMessages === 0) return 0;
  
  const deliveredMessages = await Message.countDocuments({
    createdAt: { $gte: startDate, $lt: endDate },
    status: { $in: ['delivered', 'read'] }
  });
  
  return Math.round((deliveredMessages / totalMessages) * 100);
};

export default router;