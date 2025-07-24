import Notification from '../models/Notification.js';

// Create a new notification
export const createNotification = async (notificationData, io) => {
  try {
    const notification = new Notification(notificationData);
    await notification.save();

    // Populate references for the response
    await notification.populate([
      { path: 'metadata.campaignId', select: 'name' },
      { path: 'metadata.templateId', select: 'name' },
      { path: 'metadata.contactId', select: 'name phone' },
      { path: 'metadata.messageId' }
    ]);

    // Emit socket event to the specific user
    if (io) {
      io.to(`user_${notification.userId}`).emit('new-notification', notification);
    }

    console.log(`✅ Notification created for user ${notification.userId}: ${notification.title}`);
    return notification;
  } catch (error) {
    console.error('Error creating notification:', error);
    throw error;
  }
};

// Notification helper functions for different event types
export const notifyBroadcastCompleted = async (userId, campaign, io) => {
  const successRate = campaign.progress.total > 0 
    ? Math.round((campaign.progress.sent / campaign.progress.total) * 100)
    : 0;

  return createNotification({
    userId,
    type: 'broadcast',
    title: 'Broadcast Campaign Completed',
    description: `Campaign "${campaign.name}" completed successfully. ${campaign.progress.sent}/${campaign.progress.total} messages sent (${successRate}% success rate).`,
    priority: 'medium',
    metadata: {
      campaignId: campaign._id,
      actionUrl: `/campaigns/${campaign._id}`
    }
  }, io);
};

export const notifyBroadcastFailed = async (userId, campaign, error, io) => {
  return createNotification({
    userId,
    type: 'error',
    title: 'Broadcast Campaign Failed',
    description: `Campaign "${campaign.name}" failed to complete. Error: ${error}`,
    priority: 'high',
    metadata: {
      campaignId: campaign._id,
      actionUrl: `/campaigns/${campaign._id}`
    }
  }, io);
};

export const notifyBroadcastStarted = async (userId, campaign, io) => {
  return createNotification({
    userId,
    type: 'broadcast',
    title: 'Broadcast Campaign Started',
    description: `Campaign "${campaign.name}" has started sending messages to ${campaign.progress.total} contacts.`,
    priority: 'medium',
    metadata: {
      campaignId: campaign._id,
      actionUrl: `/campaigns/${campaign._id}`
    }
  }, io);
};

export const notifyTemplateStatusChanged = async (userId, template, oldStatus, newStatus, io) => {
  let type = 'template';
  let priority = 'medium';
  let title = 'Template Status Updated';
  let description = `Template "${template.name}" status changed from ${oldStatus} to ${newStatus}.`;

  if (newStatus === 'approved') {
    type = 'success';
    title = 'Template Approved';
    description = `Template "${template.name}" has been approved and is ready to use.`;
  } else if (newStatus === 'rejected') {
    type = 'error';
    priority = 'high';
    title = 'Template Rejected';
    description = `Template "${template.name}" has been rejected. Please review and resubmit.`;
  }

  return createNotification({
    userId,
    type,
    title,
    description,
    priority,
    metadata: {
      templateId: template._id,
      actionUrl: `/templates/${template._id}`
    }
  }, io);
};

export const notifyMessageFailed = async (userId, message, contact, campaign, error, io) => {
  return createNotification({
    userId,
    type: 'error',
    title: 'Message Delivery Failed',
    description: `Failed to send message to ${contact.name} (${contact.phone}) in campaign "${campaign.name}". Error: ${error}`,
    priority: 'medium',
    metadata: {
      messageId: message._id,
      contactId: contact._id,
      campaignId: campaign._id,
      actionUrl: `/campaigns/${campaign._id}/messages`
    }
  }, io);
};

export const notifyContactAdded = async (userId, contact, io) => {
  return createNotification({
    userId,
    type: 'contact',
    title: 'New Contact Added',
    description: `Contact "${contact.name}" (${contact.phone}) has been added to your contact list.`,
    priority: 'low',
    metadata: {
      contactId: contact._id,
      actionUrl: `/contacts/${contact._id}`
    }
  }, io);
};

export const notifyIncomingResponse = async (userId, response, contact, campaign, io) => {
  const title = response.responseType === 'button' 
    ? 'Button Response Received'
    : 'Message Response Received';
    
  const description = campaign 
    ? `${contact.name} responded to campaign "${campaign.name}": "${response.responseContent}"`
    : `${contact.name} sent a message: "${response.responseContent}"`;

  return createNotification({
    userId,
    type: 'message',
    title,
    description,
    priority: 'medium',
    metadata: {
      contactId: contact._id,
      campaignId: campaign?._id,
      responseId: response._id,
      actionUrl: `/responses/${response._id}`
    }
  }, io);
};

export const notifySystemWarning = async (userId, title, description, metadata = {}, io) => {
  return createNotification({
    userId,
    type: 'warning',
    title,
    description,
    priority: 'high',
    metadata
  }, io);
};

export const notifySystemError = async (userId, title, description, metadata = {}, io) => {
  return createNotification({
    userId,
    type: 'error',
    title,
    description,
    priority: 'high',
    metadata
  }, io);
};

export const notifySystemInfo = async (userId, title, description, metadata = {}, io) => {
  return createNotification({
    userId,
    type: 'system',
    title,
    description,
    priority: 'low',
    metadata
  }, io);
};

// Bulk notification cleanup (optional utility)
export const cleanupOldNotifications = async (daysOld = 30) => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await Notification.deleteMany({
      timestamp: { $lt: cutoffDate },
      read: true
    });

    console.log(`🧹 Cleaned up ${result.deletedCount} old notifications`);
    return result.deletedCount;
  } catch (error) {
    console.error('Error cleaning up old notifications:', error);
    throw error;
  }
};