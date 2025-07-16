import express from 'express';
import { authenticate } from '../middleware/auth.js';
import Notification from '../models/Notification.js';

const router = express.Router();

// Get notifications list with pagination and filtering
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user._id;
    const { 
      page = 1, 
      limit = 20, 
      type, 
      read 
    } = req.query;

    // Build query
    const query = { userId };
    
    if (type) {
      query.type = type;
    }
    
    if (read !== undefined) {
      query.read = read === 'true';
    }

    // Get notifications with pagination
    const notifications = await Notification.find(query)
      .sort({ timestamp: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('metadata.campaignId', 'name')
      .populate('metadata.templateId', 'name')
      .populate('metadata.contactId', 'name phone')
      .populate('metadata.messageId');

    const total = await Notification.countDocuments(query);

    res.json({
      notifications,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page)
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get notification statistics
router.get('/stats', authenticate, async (req, res) => {
  try {
    const userId = req.user._id;

    // Get total and unread counts
    const total = await Notification.countDocuments({ userId });
    const unread = await Notification.countDocuments({ userId, read: false });

    // Get counts by type
    const typeAggregation = await Notification.aggregate([
      { $match: { userId } },
      { $group: { _id: '$type', count: { $sum: 1 } } }
    ]);

    const byType = {};
    typeAggregation.forEach(item => {
      byType[item._id] = item.count;
    });

    // Ensure all types are represented
    const allTypes = ['message', 'broadcast', 'template', 'system', 'contact', 'warning', 'error', 'success'];
    allTypes.forEach(type => {
      if (!byType[type]) {
        byType[type] = 0;
      }
    });

    res.json({
      total,
      unread,
      byType
    });
  } catch (error) {
    console.error('Error fetching notification stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Mark notification as read
router.patch('/:id/read', authenticate, async (req, res) => {
  try {
    const userId = req.user._id;
    const notificationId = req.params.id;

    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, userId },
      { read: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${userId}`).emit('notification-read', notificationId);
    }

    res.json({ message: 'Notification marked as read', notification });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ error: error.message });
  }
});

// Mark all notifications as read
router.patch('/mark-all-read', authenticate, async (req, res) => {
  try {
    const userId = req.user._id;

    const result = await Notification.updateMany(
      { userId, read: false },
      { read: true }
    );

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${userId}`).emit('notifications-all-read');
    }

    res.json({ 
      message: 'All notifications marked as read', 
      modifiedCount: result.modifiedCount 
    });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ error: error.message });
  }
});

// Clear all notifications
router.delete('/clear-all', authenticate, async (req, res) => {
  try {
    const userId = req.user._id;

    const result = await Notification.deleteMany({ userId });

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${userId}`).emit('notifications-cleared');
    }

    res.json({ 
      message: 'All notifications cleared', 
      deletedCount: result.deletedCount 
    });
  } catch (error) {
    console.error('Error clearing notifications:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;