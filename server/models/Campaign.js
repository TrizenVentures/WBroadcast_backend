import mongoose from 'mongoose';

const campaignSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  // WhatsApp API template fields
  templateName: {
    type: String,
    required: true
  },
  templateLanguage: {
    type: String,
    required: true
  },
  templateComponents: {
    type: Array,
    default: []
  },
  contactGroups: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ContactGroup'
  }],
  contacts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Contact'
  }],
  variables: {
    type: Map,
    of: String,
    default: new Map()
  },
  scheduledAt: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['scheduled', 'sending', 'completed', 'paused', 'cancelled', 'failed'],
    default: 'scheduled'
  },
  progress: {
    total: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    read: { type: Number, default: 0 },
    failed: { type: Number, default: 0 }
  },
  jobId: {
    type: String,
    unique: true,
    sparse: true
  },
  createdBy: {
    type: String,
    required: true
  },
  timezone: {
    type: String,
    default: 'UTC'
  },
  rateLimitPerMinute: {
    type: Number,
    default: 60
  },
  provider: {
    type: String,
    enum: ['whatsapp', 'twilio', 'auto'],
    default: 'twilio'
  },
  // n8n integration fields
  n8nWorkflowId: {
    type: String,
    sparse: true
  },
  googleCalendarEventId: {
    type: String,
    sparse: true
  },
  automatedTrigger: {
    type: Boolean,
    default: false
  },
  triggerSource: {
    type: String,
    enum: ['manual', 'n8n', 'calendar', 'api'],
    default: 'manual'
  }
}, {
  timestamps: true
});

campaignSchema.index({ scheduledAt: 1, status: 1 });
campaignSchema.index({ jobId: 1 });
campaignSchema.index({ n8nWorkflowId: 1 });
campaignSchema.index({ googleCalendarEventId: 1 });

export default mongoose.model('Campaign', campaignSchema);
