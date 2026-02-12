import express from 'express'
import agentModel from '../models/Agents.js'
import userModel from "../models/User.js"
import notificationModel from "../models/Notification.js"
import transactionModel from "../models/Transaction.js"
import { verifyToken } from '../middleware/authorization.js'
import { checkKillSwitch } from '../middleware/checkKillSwitch.js'
const route = express.Router()

//get all agents
route.get("/", async (req, res) => {
  try {
    const { view, limit, featured } = req.query;
    let filter = {};

    // If admin view, show all agents
    // If featured view (for landing page), show ONLY specific whitelist agents
    // Otherwise (marketplace), only show Live approved agents
    if (view === 'admin') {
      // No filter - show all agents
    } else if (featured === 'true') {
      // Whitelist for Featured Agents on Landing Page
      const permittedAgents = ['AIVA', 'AIBASE', 'AIBIZ', 'AICRAFT'];

      // Case-insensitive match for agentName
      filter.agentName = {
        $in: permittedAgents.map(name => new RegExp(`^${name}$`, 'i'))
      };
    } else {
      // Marketplace view - show ONLY Live approved agents
      filter.status = 'Live';
      filter.reviewStatus = 'Approved';
      filter.isDeleted = { $ne: true };
    }

    // Build query with sorting (newest first) and select only needed fields to keep payload small
    let query = agentModel.find(filter)
      .select('agentName description category avatar status reviewStatus platform url pricing createdAt slug')
      .sort({ createdAt: -1 });

    // Apply limit if provided (useful for featured sections)
    if (limit && !isNaN(parseInt(limit))) {
      query = query.limit(parseInt(limit));
    }

    const agents = await query;
    res.status(200).json(agents)
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
})

//create agents
route.post('/', verifyToken, async (req, res) => {
  try {
    const { agentName, description, category, avatar, url, pricingModel, pricingConfig } = req.body;

    // Construct pricing object
    const pricingData = {
      type: pricingModel || 'free',
      plans: pricingConfig?.selectedPlans || []
    };

    // Generate Slug explicitly
    const baseSlug = agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const uniqueSuffix = Date.now().toString(36);
    const slug = `${baseSlug}-${uniqueSuffix}`;

    // Prepare agent data
    const adminEmails = [process.env.ADMIN_EMAIL, 'aditilakhera0@gmail.com'].filter(Boolean);
    const isAdmin = req.user.role?.toLowerCase() === 'admin' ||
      adminEmails.some(email => req.user.email === email);

    const agentData = {
      agentName,
      slug, // Explicitly set slug
      description,
      category,
      // If avatar is provided, use it; otherwise let Mongoose default handle it (by not including it if it's null/empty)
      ...(avatar && { avatar }),
      url,
      pricing: pricingData,
      status: isAdmin ? 'Live' : 'Inactive',
      reviewStatus: isAdmin ? 'Approved' : 'Draft',
      owner: req.user._id || req.user.id
    };

    const newAgent = await agentModel.create(agentData);

    // If Admin created it Live, broadcast to ALL users
    if (isAdmin && agentData.status === 'Live') {
      try {
        const allUsers = await userModel.find({}).select('_id');
        const notifications = allUsers.map(u => ({
          userId: u._id,
          title: 'New App Arrival',
          message: `Exciting News: '${agentName}' has just landed in the AI Mall Marketplace. Deploy it now!`,
          type: 'info',
          role: 'user',
          targetId: newAgent._id
        }));
        if (notifications.length > 0) {
          await notificationModel.insertMany(notifications);
          console.log(`[BROADCAST] Notified ${notifications.length} users about new agent ${agentName}`);
        }
      } catch (broadcastErr) {
        console.error("Failed to broadcast new agent notification:", broadcastErr);
      }
    }

    // Agent created successfully
    res.status(201).json(newAgent);
  } catch (err) {
    console.error('[AGENT CREATE ERROR] Details:', err);
    console.error('[AGENT CREATE ERROR] Body Keys:', Object.keys(req.body));
    if (err.errors) {
      console.error('[AGENT CREATE ERROR] Mongoose Errors:', JSON.stringify(err.errors, null, 2));
    }
    res.status(400).json({ error: 'Failed to create app', details: err.message, validation: err.errors });
  }
});

//own agents
route.post('/buy/:id', async (req, res) => {
  try {
    const agentId = req.params.id;
    const { userId } = req.body;

    console.log("USER ID FROM BODY:", userId);

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const user = await userModel.findById(userId);

    // const index = user.agents.findIndex(agent => agent._id === agentId);

    // if (index !== -1) {
    //   // Remove the item
    //   user.agents.splice(index, 1);
    //   return res.status(200).json({
    //     message: "Agent added successfully",
    //     user
    //   });

    // }

    if (!user) {
      return res.status(404).json({ error: "User Not Found" });
    }

    // Avoid duplicate agent entries
    const isOwned = user.agents.some(id => id.toString() === agentId);
    if (!isOwned) {
      user.agents.push(agentId);
    } else {
      return res.status(400).json({ error: "Agent already owned" });
    }

    await user.save();

    // Record Transaction for Revenue Tracking
    const agent = await agentModel.findById(agentId);
    if (agent && agent.owner) {
      let amount = 0;
      if (agent.pricing && typeof agent.pricing === 'object') {
        // Assuming pricing might be { type: "Free" } or { amount: 10 } or similar
        // If it's free, amount is 0.
        // If plans exist, we might need more logic, but for now safe default.
        // If generic string "Free" is in type
        if (agent.pricing.type && agent.pricing.type.toLowerCase() === 'free') {
          amount = 0;
        } else {
          // Try to find a number in type or other fields? 
          // For now, let's assume 0 unless we have a specific 'cost' field.
          // Or if pricing was a string before...
          amount = 0;
        }
      } else if (typeof agent.pricing === 'string') {
        amount = parseFloat(agent.pricing.replace(/[^0-9.]/g, '')) || 0;
      }

      const platformFee = amount * 0.5; // 50% Platform Fee
      const netAmount = amount - platformFee;

      await transactionModel.create({
        agentId: agent._id,
        vendorId: agent.owner,
        buyerId: userId,
        amount,
        platformFee,
        netAmount,
        status: 'Success'
      });

      // 1. Notify Buyer (User)
      await notificationModel.create({
        userId: userId,
        title: 'Subscription Active',
        message: `Subscription Active: You have successfully subscribed to '${agent.agentName}'. Enjoy your new AI tool!`,
        type: 'success',
        role: 'user',
        targetId: agent._id
      });

      // 2. Notify Vendor
      await notificationModel.create({
        userId: agent.owner,
        title: 'New Subscriber',
        message: `New Subscriber: A user has subscribed to '${agent.agentName}'.`,
        type: 'success',
        role: 'vendor',
        targetId: agent._id
      });
    }

    res.status(200).json({
      message: "Agent added successfully",
      user
    });

  } catch (err) {
    console.error("ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

//get My agents
route.post("/get_my_agents", async (req, res) => {
  const { userId } = req.body
  const user = await userModel.findById(userId).populate("agents")
  if (!user) {
    return res.status(404).send("User Not Found")
  }
  res.status(200).json(user)
})

// Get My Agents (Authenticated)
route.get("/me", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await userModel.findById(userId).populate("agents");
    if (!user) {
      return res.status(404).json({ error: "User Not Found" });
    }
    res.status(200).json(user.agents);
  } catch (err) {
    console.error("Error fetching my agents:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// --- Review Workflow ---

// Get agents created by me (Vendor)
route.get('/created-by-me', verifyToken, async (req, res) => {
  try {
    const agents = await agentModel.find({ owner: req.user.id, isDeleted: { $ne: true } });
    res.json(agents);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Submit for review
route.patch('/:id/submit_review', verifyToken, async (req, res) => {
  try {
    const adminEmails = [process.env.ADMIN_EMAIL, 'aditilakhera0@gmail.com'].filter(Boolean);
    const isAdmin = req.user.role?.toLowerCase() === 'admin' ||
      adminEmails.some(email => req.user.email === email);

    const filter = isAdmin ? { _id: req.params.id } : { _id: req.params.id, owner: req.user._id || req.user.id };
    const agent = await agentModel.findOneAndUpdate(
      filter,
      { reviewStatus: 'Pending Review' },
      { new: true }
    );
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    // 1. Notify Admins (Targeted, excluding the sender)
    const admins = await userModel.find({ role: 'admin', _id: { $ne: req.user.id } });

    // Get Vendor Name (Current User)
    const vendor = await userModel.findById(req.user.id);
    const vendorName = vendor ? vendor.name : 'a vendor';

    if (admins.length > 0) {
      const adminNotifications = admins.map(admin => ({
        userId: admin._id,
        title: 'New App Review Request',
        message: `New App Review Request: '${agent.agentName}' has been submitted by ${vendorName}.`,
        type: 'info',
        role: 'admin',
        targetId: agent._id
      }));
      await notificationModel.insertMany(adminNotifications);
    }

    // 2. Notify Vendor (Confirmation)
    await notificationModel.create({
      userId: req.user.id,
      title: 'Submission Received',
      message: `Submission Received: '${agent.agentName}' is now under review. We will notify you once the admin completes the verification.`,
      type: 'info',
      role: 'vendor',
      targetId: agent._id
    });

    res.json(agent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deactivate App
route.patch('/:id/deactivate', verifyToken, async (req, res) => {
  try {
    const agent = await agentModel.findOneAndUpdate(
      { _id: req.params.id, owner: req.user.id },
      { status: 'Inactive' },
      { new: true }
    );
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    res.json(agent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reactivate App
route.patch('/:id/reactivate', verifyToken, async (req, res) => {
  try {
    const agent = await agentModel.findOneAndUpdate(
      { _id: req.params.id, owner: req.user.id },
      { status: 'Live' }, // Or check previous status? assuming Live for now
      { new: true }
    );
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    res.json(agent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// Approve (Admin)
route.post('/approve/:id', verifyToken, async (req, res) => {
  try {
    // Check Admin Role (Robust Check)
    const requester = await userModel.findById(req.user.id);
    const isAdmin = requester?.role?.toLowerCase() === 'admin' || requester?.email === 'admin@uwo24.com';

    if (!isAdmin) {
      return res.status(403).json({ error: "Access Denied. Admins only." });
    }

    const { message, avatar } = req.body;
    const updateData = {
      reviewStatus: 'Approved',
      status: 'Live'
    };

    // If Admin uploaded an avatar, update it
    if (avatar) {
      updateData.avatar = avatar;
    }

    const agent = await agentModel.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    if (agent && agent.owner) {
      // 1. Notify Vendor
      await notificationModel.create({
        userId: agent.owner,
        title: 'App Approved',
        message: `Time to celebrate! '${agent.agentName}' has been approved and is now live on the AI Mall Marketplace.${message ? ' Note: ' + message : ''}`,
        type: 'success',
        role: 'vendor',
        targetId: agent._id
      });

      // 2. Notify All Users (Marketplace Update)
      // Broadcast to everyone (Admins, Vendors, Users) so they all see the new app
      const allUsers = await userModel.find({}).select('_id');
      const notifications = allUsers.map(u => ({
        userId: u._id,
        title: 'New Agent Available',
        message: `New Arrival: '${agent.agentName}' is now available in the marketplace. Check it out!`,
        type: 'info',
        role: 'user',
        targetId: agent._id
      }));

      if (notifications.length > 0) {
        await notificationModel.insertMany(notifications);
      }
    }

    res.json(agent);
  } catch (err) {
    console.error('[APPROVE ERROR]', err);
    res.status(500).json({ error: err.message });
  }
});

// Reject (Admin)
route.post('/reject/:id', verifyToken, async (req, res) => {
  try {
    // Check Admin Role (Robust Check)
    const requester = await userModel.findById(req.user.id);
    const isAdmin = requester?.role?.toLowerCase() === 'admin' || requester?.email === 'admin@uwo24.com';

    if (!isAdmin) {
      return res.status(403).json({ error: "Access Denied. Admins only." });
    }

    const { reason } = req.body;
    const agent = await agentModel.findByIdAndUpdate(
      req.params.id,
      { reviewStatus: 'Rejected', status: 'Inactive', rejectionReason: reason },
      { new: true }
    );

    if (agent && agent.owner) {
      // Notify Vendor with Reason
      await notificationModel.create({
        userId: agent.owner,
        title: 'App Rejected',
        message: `Action Required: '${agent.agentName}' could not be approved. Reason: ${reason}. Please make changes and resubmit.`,
        type: 'error',
        role: 'vendor',
        targetId: agent._id
      });
    }

    res.json(agent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- General CRUD ---

// Get agent details with usage stats (for vendor dashboard)
route.get('/:id/details', verifyToken, async (req, res) => {
  try {
    const agent = await agentModel.findById(req.params.id);
    if (!agent) {
      return res.status(404).json({ error: "Agent not found" });
    }

    // Get usage statistics from transactions
    const transactions = await transactionModel.find({ agentId: req.params.id });

    // Calculate plan-wise breakdown
    const planCounts = {
      free: 0,
      basic: 0,
      premium: 0
    };

    // Get unique users
    const uniqueUsers = new Set();
    transactions.forEach(t => {
      uniqueUsers.add(t.buyerId?.toString());
    });

    // Convert to array format for frontend
    const planBreakdown = [
      { name: 'Free', users: planCounts.free },
      { name: 'Basic', users: planCounts.basic },
      { name: 'Pro', users: planCounts.premium }
    ];

    const usage = {
      totalUsers: uniqueUsers.size,
      planBreakdown,
      recentActivity: [] // Can be populated with actual activity data
    };

    res.json({
      agent,
      usage
    });
  } catch (err) {
    console.error('[AGENT DETAILS ERROR]', err);
    res.status(500).json({ error: "Failed to fetch agent details" });
  }
});

route.get('/:id', async (req, res) => {
  try {
    const agent = await agentModel.findById(req.params.id);
    res.json(agent);
  } catch (err) {
    res.status(404).json({ error: "Agent not found" });
  }
});

route.put('/:id', verifyToken, async (req, res) => {
  try {
    const adminEmails = [process.env.ADMIN_EMAIL, 'admin@uwo24.com'].filter(Boolean);
    const isAdmin = req.user.role?.toLowerCase() === 'admin' ||
      adminEmails.some(email => req.user.email === email);

    // If Admin is making it Live, automatically Approve it
    const updateData = { ...req.body };
    if (isAdmin && updateData.status === 'Live') {
      updateData.reviewStatus = 'Approved';
    }

    // Allow Admins to update any agent, owners only their own
    const userId = req.user._id || req.user.id;
    const filter = isAdmin ? { _id: req.params.id } : { _id: req.params.id, owner: userId };

    const agent = await agentModel.findOneAndUpdate(
      filter,
      updateData,
      { new: true }
    );

    if (!agent) {
      console.log(`[AGENT UPDATE] No agent found or unauthorized. ID: ${req.params.id}, User: ${userId}, IsAdmin: ${isAdmin}`);
      return res.status(404).json({ error: "Agent not found or unauthorized" });
    }

    // If Admin JUST made it Live (status changed to Live), broadcast to ALL users
    if (isAdmin && updateData.status === 'Live') {
      try {
        const allUsers = await userModel.find({}).select('_id');
        const notifications = allUsers.map(u => ({
          userId: u._id,
          title: 'New Agent Available',
          message: `New Arrival: '${agent.agentName}' is now available in the marketplace. Check it out!`,
          type: 'info',
          role: 'user',
          targetId: agent._id
        }));
        if (notifications.length > 0) {
          await notificationModel.insertMany(notifications);
          console.log(`[BROADCAST] Notified ${notifications.length} users about live update for ${agent.agentName}`);
        }
      } catch (broadcastErr) {
        console.error("Failed to broadcast status update notification:", broadcastErr);
      }
    }

    res.json(agent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

route.delete('/:id', verifyToken, async (req, res) => {
  try {
    // Verify Agent Exists
    const agent = await agentModel.findById(req.params.id);
    if (!agent) {
      return res.status(404).json({ error: "Agent not found" });
    }

    const adminEmails = [process.env.ADMIN_EMAIL, 'admin@uwo24.com'].filter(Boolean);
    const isAdmin = req.user.role?.toLowerCase() === 'admin' ||
      adminEmails.some(email => req.user.email === email);

    console.log(`[DELETE AGENT] Request by User: ${req.user._id || req.user.id}, Email: ${req.user.email}, IsAdmin: ${isAdmin}`);

    // 1. If Admin -> Proceed with Hard Delete (Moderation Action)
    if (isAdmin) {
      console.log(`[DELETE AGENT] User ${req.user.id} is ADMIN (by role or email). Performing Hard Delete.`);

      // Notify Agent Owner
      if (agent.owner) {
        try {
          await notificationModel.create({
            userId: agent.owner,
            title: 'Agent Removed by Admin',
            message: `Administrative Action: Your agent '${agent.agentName}' has been removed from the marketplace by an administrator.`,
            type: 'error',
            role: 'vendor',
            targetId: agent._id
          });
          console.log(`[DELETE AGENT] Notified owner ${agent.owner}`);
        } catch (notifErr) {
          console.error("Failed to notify owner about deletion:", notifErr);
        }
      }

      // Notify Subscribers (Safely) - Send BEFORE deleting
      try {
        const transactions = await transactionModel.find({ agentId: agent._id });
        const uniqueBuyers = [...new Set(transactions.map(t => t.buyerId?.toString()))].filter(id => id);

        // 1. Notify Subscribers (Warning)
        const subNotifications = uniqueBuyers.map(userId => ({
          userId,
          title: 'App Removed',
          message: `Important Update: '${agent.agentName}' has been removed from the marketplace. Your subscription will not renew.`,
          type: 'warning',
          role: 'user',
          targetId: agent._id
        }));

        if (subNotifications.length > 0) {
          await notificationModel.insertMany(subNotifications);
        }

        // 2. Broadcast to EVERYONE (Global Removal Notice)
        const allUsers = await userModel.find({}).select('_id');
        const globalNotifications = allUsers.map(u => ({
          userId: u._id,
          title: 'Marketplace Update',
          message: `System Alert: '${agent.agentName}' has been removed from the marketplace for maintenance or optimization.`,
          type: 'info',
          role: 'user'
        }));

        if (globalNotifications.length > 0) {
          await notificationModel.insertMany(globalNotifications);
        }

        console.log(`[DELETE AGENT] Notified ${uniqueBuyers.length} subscribers and ${allUsers.length} total users`);
      } catch (notifErr) {
        console.error("Failed to send deletion notifications to subscribers:", notifErr);
      }

      // Hard Delete from Database
      await agentModel.findByIdAndDelete(req.params.id);
      return res.json({ message: "Agent permanently deleted by Admin", agentId: req.params.id });
    }

    // 2. Check if Vendor (Owner) - workflow-based
    // Use string comparison for ObjectIds
    if (agent.owner.toString() === req.user.id.toString()) {
      console.log(`[DELETE AGENT] User ${req.user.id} is OWNER of Agent ${agent._id}. Initiating Pending Deletion.`);
      agent.deletionStatus = 'Pending';
      await agent.save();

      // Notify Admins
      const admins = await userModel.find({ role: 'admin' });
      // Filter out the requestor if they are an admin, to avoid spamming themselves? 
      // Actually, if testing, it's good to see the notification.

      const adminNotifications = admins.map(admin => ({
        userId: admin._id,
        title: 'Deletion Request',
        message: `Deletion Request: Vendor '${requestor?.name || 'Unknown'}' has requested to delete '${agent.agentName}'.`,
        type: 'warning',
        role: 'admin',
        targetId: agent._id
      }));

      if (adminNotifications.length > 0) {
        await notificationModel.insertMany(adminNotifications);
      }

      return res.json({ message: "Deletion request submitted. Pending Admin Approval.", deletionStatus: 'Pending', agentId: req.params.id });
    }

    // If neither Admin nor Owner
    console.log(`[DELETE AGENT] Access Denied for User ${req.user.id}. IsAdmin: ${isAdmin}, IsOwner: ${agent.owner.toString() === req.user.id.toString()}`);
    return res.status(403).json({ error: "Access Denied. You must be an administrator or the agent owner." });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Approve Deletion
route.post('/admin/approve-deletion/:id', verifyToken, async (req, res) => {
  try {
    const requester = await userModel.findById(req.user.id);
    const isAdmin = requester?.role?.toLowerCase() === 'admin' || requester?.email === 'aditilakhera0@gmail.com';

    if (!isAdmin) {
      return res.status(403).json({ error: "Access Denied. Admins only." });
    }

    const agent = await agentModel.findById(req.params.id);
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    // Notify Vendor
    await notificationModel.create({
      userId: agent.owner,
      title: 'Deletion Approved',
      message: `Deletion Approved: '${agent.agentName}' has been permanently deleted as requested.`,
      type: 'info',
      role: 'vendor'
    });

    // Notify Subscribers (Same logic as hard delete)
    const transactions = await transactionModel.find({ agentId: agent._id });
    const uniqueBuyers = [...new Set(transactions.map(t => t.buyerId?.toString()))].filter(id => id);
    const notifications = uniqueBuyers.map(userId => ({
      userId,
      title: 'App Removed',
      message: `Important Update: '${agent.agentName}' has been removed from the marketplace.`,
      type: 'warning',
      role: 'user'
    }));
    if (notifications.length > 0) await notificationModel.insertMany(notifications);

    await agentModel.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Agent deleted successfully" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Reject Deletion
route.post('/admin/reject-deletion/:id', verifyToken, async (req, res) => {
  try {
    const requester = await userModel.findById(req.user.id);
    const isAdmin = requester?.role?.toLowerCase() === 'admin' || requester?.email === 'aditilakhera0@gmail.com';

    if (!isAdmin) {
      return res.status(403).json({ error: "Access Denied. Admins only." });
    }

    const { reason } = req.body;
    const agent = await agentModel.findByIdAndUpdate(
      req.params.id,
      { deletionStatus: 'None' },
      { new: true }
    );

    if (!agent) return res.status(404).json({ error: "Agent not found" });

    // Notify Vendor
    await notificationModel.create({
      userId: agent.owner,
      title: 'Deletion Rejected',
      message: `Deletion Request Rejected: We cannot delete '${agent.agentName}' at this time. Reason: ${reason || 'Contact Admin'}.`,
      type: 'error',
      role: 'vendor',
      targetId: agent._id
    });

    res.json({ success: true, agent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get vendor users (subscribers)
route.get('/vendor-users/:vendorId', verifyToken, async (req, res) => {
  try {
    const { vendorId } = req.params;

    // Verify ownership
    if (req.user.id !== vendorId && req.user.role !== 'admin') {
      return res.status(403).json({ error: "Access Denied" });
    }

    // 1. Get all agents owned by this vendor
    const agents = await agentModel.find({ owner: vendorId }).select('_id agentName');
    const agentIds = agents.map(a => a._id);

    // 2. Find transactions for these agents
    const transactions = await transactionModel.find({ agentId: { $in: agentIds } })
      .populate('buyerId', 'name email')
      .populate('agentId', 'agentName pricing');

    // 3. Transform to user list
    // Use a Map to ensure unique users per app if needed, or just list all subscriptions
    // The UI shows a list, so let's list every active subscription. 
    // If a user has multiple apps, show them multiple times or group? 
    // The table has "App / Agent" column, so listing entries per subscription makes sense.

    const userList = transactions.map(t => {
      // Determine plan name based on amount or pricingType
      // Simple logic for now based on amount
      let plan = 'Free';
      if (t.amount > 0) {
        plan = t.amount > 50 ? 'Pro' : 'Basic'; // Example logic
      }

      return {
        id: t.buyerId?._id || 'unknown',
        name: t.buyerId?.name || 'Unknown User',
        email: t.buyerId?.email || 'N/A',
        app: t.agentId?.agentName || 'Unknown App',
        plan: plan,
        joinedAt: t.createdAt
      };
    }).filter(u => u.name !== 'Unknown User'); // Filter out invalid users

    res.json(userList);
  } catch (err) {
    console.error('[VENDOR USERS ERROR]', err);
    res.status(500).json({ error: "Failed to fetch vendor users" });
  }
});

// Vendor Admin Support Messages
route.get('/vendor/:userId/support', verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { type } = req.query;

    // Verify ownership
    if (req.user.id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: "Access Denied" });
    }

    // Fetch messages from Notification model that act as "Admin Directives"
    // Assuming type 'admin_directive' or similar. For now, we return specific notifications or empty.
    // We map it to the structure expected by frontend: senderId, subject, status.
    const notifications = await notificationModel.find({
      userId: userId,
      type: 'admin_directive' // Using a specific type for these messages
    }).sort({ createdAt: -1 });

    const messages = notifications.map(n => ({
      _id: n._id,
      senderId: 'Admin', // Hardcoded as these are from admin
      subject: n.message.substring(0, 50) + '...', // Use message start as subject if not present
      createdAt: n.createdAt,
      status: n.read ? 'Responded' : 'Open' // Mapping read status to UI status
    }));

    res.json(messages);
  } catch (err) {
    console.error('[VENDOR SUPPORT ERROR]', err);
    res.status(500).json({ error: "Failed to fetch support messages" });
  }
});

export default route