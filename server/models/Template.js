import mongoose from 'mongoose';

const templateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  body: {
    type: String,
    required: true
  },
  variables: [{
    name: String,
    type: {
      type: String,
      enum: ['text', 'number', 'date'],
      default: 'text'
    },
    required: {
      type: Boolean,
      default: false
    }
  }],
  category: {
    type: String,
    enum: ['MARKETING', 'TRANSACTIONAL', 'UTILITY'],
    required: true
  },
  language: {
    type: String,
    default: 'EN'
  },
  status: {
    type: String,
    enum: ['draft', 'pending', 'approved', 'rejected'],
    default: 'draft'
  },
  whatsappTemplateId: {
    type: String,
    unique: true,
    sparse: true
  },
  whatsappTemplateName: {
    type: String,
    required: function() {
      return this.provider === 'whatsapp';
    }
  },
  // WhatsApp template configuration
  whatsappConfig: {
    language: {
      type: String,
      default: 'en'
    },
    hasButtons: {
      type: Boolean,
      default: false
    },
    buttons: [{
      type: {
        type: String,
        enum: ['quick_reply', 'call_to_action'],
        default: 'quick_reply'
      },
      text: String,
      payload: String // For quick_reply buttons
    }],
    headerType: {
      type: String,
      enum: ['text', 'image', 'video', 'document', 'none'],
      default: 'none'
    },
    footerText: String
  },
  // Message provider
  provider: {
    type: String,
    enum: ['whatsapp', 'sms', 'email'],
    default: 'whatsapp'
  }
}, {
  timestamps: true
});

templateSchema.index({ status: 1 });
templateSchema.index({ category: 1 });

export default mongoose.model('Template', templateSchema);