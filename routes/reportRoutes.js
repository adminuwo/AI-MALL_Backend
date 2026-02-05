import express from 'express';
import mongoose from 'mongoose';
import Report from '../models/Report.js';
import ReportMessage from '../models/ReportMessage.js';
import Notification from '../models/Notification.js';
import { verifyToken } from '../middleware/authorization.js';
import { sendAdminNotification, sendVendorReply } from '../services/emailService.js';

const router = express.Router();

// GET /api/reports (Admin only - fetch all reports)
router.get('/', verifyToken, async (req, res) => {
    try {
        const isAdmin = req.user.role === 'admin' || req.user.email === 'admin@uwo24.com';
        if (!isAdmin) {
            return res.status(403).json({ error: 'Admin access required' });
        }

        // Find all reports, populate user details
        const reports = await Report.find()
            .populate('userId', 'name email')
            .sort({ timestamp: -1 });

        // Fetch latest message for each report to show as preview/history
        const reportsWithLastMessage = await Promise.all(reports.map(async (report) => {
            const lastMsg = await ReportMessage.findOne({ reportId: report._id })
                .sort({ createdAt: -1 });

            return {
                ...report.toObject(),
                latestMessage: lastMsg ? lastMsg.message : report.description
            };
        }));

        res.json(reportsWithLastMessage);
    } catch (err) {
        console.error('[FETCH REPORTS ERROR]', err);
        res.status(500).json({ error: 'Failed to fetch reports' });
    }
});

// GET /api/reports/me (Fetch reports for the logged-in user)
router.get('/me', verifyToken, async (req, res) => {
    try {
        const reports = await Report.find({ userId: req.user.id })
            .sort({ timestamp: -1 });
        res.json(reports);
    } catch (err) {
        console.error('[FETCH MY REPORTS ERROR]', err);
        res.status(500).json({ error: 'Failed to fetch your reports' });
    }
});

// GET /api/reports/user/:userId (Fetch reports for a specific user - Admin only)
router.get('/user/:userId', verifyToken, async (req, res) => {
    try {
        const { userId } = req.params;
        const { type } = req.query; // Optional filter by type

        console.log(`[FETCH REPORTS FOR USER] UserId: ${userId}, Type: ${type}, Requestor Role: ${req.user.role}`);

        // Authorization check: User must be admin or requesting their own reports
        const adminEmail = process.env.ADMIN_EMAIL || 'admin@uwo24.com';
        const isAdmin = req.user.role?.toLowerCase() === 'admin' || req.user.email === adminEmail;

        // Authorization check: User must be admin or requesting their own reports
        if (!isAdmin && req.user.id !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const query = { userId };
        if (type) {
            query.type = type;
        }

        const reports = await Report.find(query)
            .sort({ timestamp: -1 });

        console.log(`[FETCH REPORTS FOR USER] Found ${reports.length} reports`);
        res.json(reports);
    } catch (err) {
        console.error('[FETCH USER REPORTS ERROR]', err);
        res.status(500).json({ error: 'Failed to fetch user reports' });
    }
});

// POST /api/reports/submit (User submits a report)
router.post('/submit', verifyToken, async (req, res) => {
    try {
        const { type, priority, description, targetId } = req.body;
        const currentUserId = req.user._id || req.user.id;

        console.log(`[DEBUG SUBMIT] Category: ${type}, User: ${currentUserId}`);

        // 1. Find an existing active report for this user & category
        let report = await Report.findOne({
            userId: currentUserId,
            type,
            status: { $in: ['open', 'in-progress'] }
        });

        if (report) {
            console.log(`[DEBUG SUBMIT] Found existing report ${report._id}. Appending message.`);

            // Add follow-up message
            await ReportMessage.create({
                reportId: report._id,
                senderId: currentUserId,
                senderRole: 'user',
                message: description
            });

            // Update timestamp to bubble it up
            report.timestamp = new Date();
            await report.save();

            return res.json(report);
        }

        // 2. No active report found, create a NEW one
        console.log('[DEBUG SUBMIT] Creating fresh report.');
        const newReport = await Report.create({
            userId: currentUserId,
            type,
            priority,
            description,
            status: 'open',
            targetId
        });

        // 3. IMPORTANT: Also record the initial message in ReportMessage collection
        // This ensures the history always includes the very first message
        await ReportMessage.create({
            reportId: newReport._id,
            senderId: currentUserId,
            senderRole: 'user',
            message: description
        });

        console.log(`[DEBUG SUBMIT] Created new report ${newReport._id} with initial message history.`);

        // Populate user details for email notification
        await newReport.populate('userId', 'name email');
        await sendAdminNotification(newReport);

        res.status(201).json(newReport);
    } catch (err) {
        console.error('[SUBMIT REPORT ERROR]', err);
        res.status(500).json({ error: 'Failed to submit report' });
    }
});

// POST /api/reports/:id/reply (Admin sends email reply to vendor)
router.post('/:id/reply', verifyToken, async (req, res) => {
    try {
        const adminEmail = process.env.ADMIN_EMAIL || 'admin@uwo24.com';
        const isAdmin = req.user.role?.toLowerCase() === 'admin' || req.user.email === adminEmail;
        if (!isAdmin) {
            return res.status(403).json({ error: 'Admin access required' });
        }
        const { message } = req.body;
        const reportId = req.params.id;

        // Find report and populate user details
        const report = await Report.findById(reportId).populate('userId', 'name email');

        if (!report) {
            return res.status(404).json({ error: 'Report not found' });
        }

        if (!report.userId || !report.userId.email) {
            return res.status(400).json({ error: 'Vendor email not found' });
        }

        // Send email reply to vendor
        const emailResult = await sendVendorReply(
            report.userId.email,
            report.userId.name,
            message,
            reportId
        );

        if (!emailResult.success) {
            return res.status(500).json({ error: emailResult.message });
        }

        // Create notification for vendor
        await Notification.create({
            userId: report.userId._id,
            title: 'New Support Reply',
            message: `Admin replied to your support ticket: "${message.substring(0, 50)}..."`,
            type: 'info',
            targetId: reportId
        });

        res.json({ success: true, message: 'Reply sent successfully' });
    } catch (err) {
        console.error('[REPLY TO REPORT ERROR]', err);
        res.status(500).json({ error: 'Failed to send reply' });
    }
});

// PUT /api/reports/:id/resolve (Admin updates status)
router.put('/:id/resolve', verifyToken, async (req, res) => {
    try {
        const isAdmin = req.user.role === 'admin' || req.user.email === 'admin@uwo24.com';
        if (!isAdmin) {
            return res.status(403).json({ error: 'Admin access required' });
        }
        const { status, resolutionNote } = req.body;
        const reportId = req.params.id;

        // Fetch old report to compare
        const oldReport = await Report.findById(reportId);
        if (!oldReport) return res.status(404).json({ error: 'Report not found' });

        const statusChanged = oldReport.status !== status;
        const noteChanged = oldReport.resolutionNote !== resolutionNote;

        // If nothing changed, just return a success message without creating a new notification
        if (!statusChanged && !noteChanged) {
            return res.json(oldReport);
        }

        const report = await Report.findByIdAndUpdate(
            reportId,
            { status, resolutionNote },
            { new: true }
        );

        // Notify the user who submitted the report
        let notificationMessage = '';
        if (statusChanged && noteChanged && resolutionNote) {
            notificationMessage = `Your report (ID: ${report._id.toString().substring(0, 8)}) status has been updated to: ${status}. Admin response: "${resolutionNote}"`;
        } else if (statusChanged) {
            notificationMessage = `Your report (ID: ${report._id.toString().substring(0, 8)}) status has been updated to: ${status}`;
        } else if (noteChanged && resolutionNote) {
            notificationMessage = `Admin has responded to your report (ID: ${report._id.toString().substring(0, 8)}): "${resolutionNote}"`;
        }

        // NEW: Record admin response as a Message if a note was provided
        if (noteChanged && resolutionNote) {
            const currentUserId = req.user._id || req.user.id;
            await ReportMessage.create({
                reportId: report._id,
                senderId: currentUserId,
                senderRole: 'admin',
                message: resolutionNote
            });
        }

        if (notificationMessage) {
            await Notification.create({
                userId: report.userId,
                title: 'New Support Reply',
                message: notificationMessage,
                type: status === 'resolved' ? 'success' : 'info',
                targetId: report._id
            });
        }

        res.json(report);
    } catch (err) {
        console.error('[RESOLVE REPORT ERROR]', err);
        res.status(500).json({ error: 'Failed to update report' });
    }
});

// DELETE /api/reports/:id (Admin only - delete report)
router.delete('/:id', verifyToken, async (req, res) => {
    try {
        const isAdmin = req.user.role === 'admin' || req.user.email === 'admin@uwo24.com';
        if (!isAdmin) {
            return res.status(403).json({ error: 'Admin access required' });
        }
        const reportId = req.params.id;
        const report = await Report.findByIdAndDelete(reportId);

        if (!report) {
            return res.status(404).json({ error: 'Report not found' });
        }

        // Also delete associated messages
        await ReportMessage.deleteMany({ reportId });

        res.json({ message: 'Report deleted successfully' });
    } catch (err) {
        console.error('[DELETE REPORT ERROR]', err);
        res.status(500).json({ error: 'Failed to delete report' });
    }
});

// GET /api/reports/:reportId/messages - Fetch all messages for a report
router.get('/:reportId/messages', verifyToken, async (req, res) => {
    try {
        const { reportId } = req.params;

        // Authorization check: User must be admin or report owner
        const report = await Report.findById(reportId);
        if (!report) return res.status(404).json({ error: 'Report not found' });

        console.log(`[DEBUG FETCH] Fetching messages for report: ${reportId}. Type: ${report.type}`);

        const adminEmail = process.env.ADMIN_EMAIL || 'admin@uwo24.com';
        const isAdmin = req.user.role?.toLowerCase() === 'admin' || req.user.email === adminEmail;
        const currentUserId = (req.user._id || req.user.id).toString();

        if (!isAdmin && report.userId.toString() !== currentUserId) {
            console.log(`[DEBUG FETCH] Access denied. Report UserId: ${report.userId}, Auth UserId: ${currentUserId}`);
            return res.status(403).json({ error: 'Access denied' });
        }

        // Use both formatted ObjectId and raw string for maximum compatibility
        const messages = await ReportMessage.find({
            $or: [
                { reportId: reportId },
                { reportId: new mongoose.Types.ObjectId(reportId) }
            ]
        }).sort({ createdAt: 1 });

        console.log(`[DEBUG FETCH] Found ${messages.length} messages for report ${reportId}`);
        // Log the first message content if any
        if (messages.length > 0) {
            console.log(`[DEBUG FETCH] First message sender: ${messages[0].senderRole}, text: ${messages[0].message.substring(0, 20)}`);
        }
        res.json(messages);
    } catch (err) {
        console.error('[FETCH REPORT MESSAGES ERROR]', err);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// POST /api/reports/:reportId/messages - Add a message to a report
router.post('/:reportId/messages', verifyToken, async (req, res) => {
    try {
        const { reportId } = req.params;
        const { message } = req.body;

        if (!message) return res.status(400).json({ error: 'Message is required' });

        // Populate userId to get vendor details for sync
        const report = await Report.findById(reportId).populate('userId', 'name email');
        if (!report) return res.status(404).json({ error: 'Report not found' });

        const adminEmail = process.env.ADMIN_EMAIL || 'admin@uwo24.com';
        const isAdmin = req.user.email === adminEmail || req.user.role?.toLowerCase() === 'admin';
        const senderRole = isAdmin ? 'admin' : (req.user.role?.toLowerCase() || 'vendor');

        const newMessage = await ReportMessage.create({
            reportId,
            senderId: req.user.id,
            senderRole,
            message
        });

        // --- NEW: Sync to VendorMessage (Direct Message) for cross-system visibility ---
        if (isAdmin && report.type === 'AdminSupport' && report.userId) {
            try {
                const VendorMessage = (await import('../models/VendorMessage.js')).default;

                // Admin -> Vendor: userId = Admin, vendorId = Vendor
                await VendorMessage.create({
                    userId: req.user.id, // The Admin
                    vendorId: report.userId._id, // The Vendor
                    userName: 'AI-MALL Admin',
                    userEmail: req.user.email,
                    vendorEmail: report.userId.email,
                    subject: report.description || 'Admin Support Message',
                    message: message,
                    senderType: 'Admin',
                    status: 'Replied'
                });
                console.log(`[Sync] Synced Admin ReportMessage to VendorMessage for Vendor ${report.userId.email}`);
            } catch (syncErr) {
                console.error('[Sync Error] Failed to sync to VendorMessage:', syncErr);
            }
        }
        // --------------------------------------------------------------------------

        res.status(201).json(newMessage);
    } catch (err) {
        console.error('[SEND REPORT MESSAGE ERROR]', err);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// DELETE /api/reports/:reportId/messages - Delete all messages from a report (clear chat)
router.delete('/:reportId/messages', verifyToken, async (req, res) => {
    console.log('🔥🔥🔥 DELETE REPORT MESSAGES ROUTE HIT! ReportId:', req.params.reportId);
    console.log('🔥 User:', req.user?.id, req.user?.role);

    try {
        const { reportId } = req.params;

        // Authorization check: User must be admin or report owner
        const report = await Report.findById(reportId);
        console.log('🔍 Report found:', !!report);

        if (!report) {
            console.log('❌ Report NOT found, returning 404');
            return res.status(404).json({ error: 'Report not found' });
        }

        const adminEmail = process.env.ADMIN_EMAIL || 'admin@uwo24.com';
        const isAdmin = req.user.role?.toLowerCase() === 'admin' || req.user.email === adminEmail;
        if (!isAdmin && report.userId.toString() !== req.user.id) {
            console.log('❌ Unauthorized delete attempt');
            return res.status(403).json({ error: 'Access denied' });
        }

        console.log('✅ Deleting messages for report:', reportId);
        // Delete all messages for this report
        const result = await ReportMessage.deleteMany({ reportId });
        console.log(`✅✅✅ Deleted ${result.deletedCount} messages successfully!`);

        res.json({ message: 'Report messages deleted successfully', deletedCount: result.deletedCount });
    } catch (err) {
        console.error('❌ [DELETE REPORT MESSAGES ERROR]', err);
        res.status(500).json({ error: 'Failed to delete messages' });
    }
});

export default router;
