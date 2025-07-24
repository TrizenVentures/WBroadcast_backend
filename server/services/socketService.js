export const setupSocketHandlers = (io) => {
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Handle user authentication and join user-specific room
    socket.on('authenticate', (userId) => {
      if (userId) {
        socket.join(`user_${userId}`);
        console.log(`Socket ${socket.id} joined user room: user_${userId}`);
      }
    });

    // Join campaign room for real-time updates
    socket.on('join-campaign', (campaignId) => {
      socket.join(`campaign-${campaignId}`);
      console.log(`Socket ${socket.id} joined campaign room: ${campaignId}`);
    });

    // Leave campaign room
    socket.on('leave-campaign', (campaignId) => {
      socket.leave(`campaign-${campaignId}`);
      console.log(`Socket ${socket.id} left campaign room: ${campaignId}`);
    });

    // Join dashboard room for real-time dashboard updates
    socket.on('join-dashboard', (userId) => {
      if (userId) {
        socket.join(`dashboard_${userId}`);
        console.log(`Socket ${socket.id} joined dashboard room: dashboard_${userId}`);
      }
    });

    // Leave dashboard room
    socket.on('leave-dashboard', (userId) => {
      if (userId) {
        socket.leave(`dashboard_${userId}`);
        console.log(`Socket ${socket.id} left dashboard room: dashboard_${userId}`);
      }
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });

  // Helper function to emit to specific campaign room
  io.emitToCampaign = (campaignId, event, data) => {
    io.to(`campaign-${campaignId}`).emit(event, data);
  };

  // Helper function to emit to specific user room
  io.emitToUser = (userId, event, data) => {
    io.to(`user_${userId}`).emit(event, data);
  };

  // Helper function to emit dashboard updates to specific user
  io.emitDashboardUpdate = (userId, updateType, data) => {
    io.to(`dashboard_${userId}`).emit('dashboard-update', {
      type: updateType,
      data
    });
  };
};