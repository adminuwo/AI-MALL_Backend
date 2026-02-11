import Razorpay from 'razorpay';
import crypto from 'crypto';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

export const createOrder = async (req, res) => {
    try {
        const { plan } = req.body;
        const userId = req.user.id;

        if (!plan) {
            return res.status(400).json({ error: "Plan is required" });
        }

        let amount = 0;
        switch (plan.toLowerCase()) {
            case 'basic':
                amount = 0;
                break;
            case 'pro':
                amount = 499;
                break;
            case 'king':
                amount = 1499;
                break;
            default:
                return res.status(400).json({ error: "Invalid plan selected" });
        }

        // If amount is 0 (Basic plan), update user immediately
        if (amount === 0) {
            const updatedUser = await User.findByIdAndUpdate(
                userId,
                {
                    plan: 'Basic',
                    subscription: {
                        status: 'active',
                        currentPeriodEnd: null
                    }
                },
                { new: true }
            );
            return res.status(200).json({ message: "Plan updated to Basic", user: updatedUser, amount: 0 });
        }

        const options = {
            amount: amount * 100, // amount in the smallest currency unit (paise)
            currency: "INR",
            receipt: `receipt_${Date.now()}`,
        };

        const order = await razorpay.orders.create(options);

        if (!order) {
            return res.status(500).json({ error: "Failed to create Razorpay order" });
        }

        res.status(200).json({
            id: order.id,
            amount: order.amount,
            currency: order.currency,
            key: process.env.RAZORPAY_KEY_ID
        });

    } catch (error) {
        console.error("Razorpay Create Order Error:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

export const verifyPayment = async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan, amount } = req.body;
        const userId = req.user.id;

        console.log('[VERIFY PAYMENT] Received data:', {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            plan,
            amount,
            userId
        });

        const body = razorpay_order_id + "|" + razorpay_payment_id;

        const expectedSignature = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(body.toString())
            .digest("hex");

        console.log('[VERIFY PAYMENT] Signature comparison:', {
            received: razorpay_signature,
            expected: expectedSignature,
            match: expectedSignature === razorpay_signature
        });

        const isAuthentic = expectedSignature === razorpay_signature;

        if (isAuthentic) {
            const capitalizedPlan = plan.charAt(0).toUpperCase() + plan.slice(1);

            // Update User Plan
            const updatedUser = await User.findByIdAndUpdate(
                userId,
                {
                    plan: capitalizedPlan,
                    subscription: {
                        status: 'active',
                        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
                        razorpay_payment_id,
                        razorpay_order_id,
                        razorpay_signature
                    }
                },
                { new: true }
            );

            if (!updatedUser) {
                console.error('[VERIFY PAYMENT] User not found in database:', userId);
                return res.status(404).json({ error: "User not found in database" });
            }

            // Create Transaction Record
            await Transaction.create({
                buyerId: userId,
                transactionId: razorpay_payment_id,
                amount: amount / 100,
                plan: capitalizedPlan,
                paymentId: razorpay_payment_id,
                orderId: razorpay_order_id,
                status: 'Success'
            });

            console.log('[VERIFY PAYMENT] Success - User updated:', updatedUser.email);

            res.status(200).json({
                message: "Payment verified successfully",
                user: updatedUser
            });
        } else {
            console.error('[VERIFY PAYMENT] Signature mismatch!');
            res.status(400).json({ error: "Invalid payment signature" });
        }

    } catch (error) {
        console.error("Payment Verification Error:", error);
        res.status(500).json({ error: "Failed to verify payment" });
    }
};

export const getPaymentHistory = async (req, res) => {
    try {
        const userId = req.user?.id || req.user?._id;
        console.log(`[PAYMENT] Fetching history for user: ${userId}`);

        if (!userId) {
            return res.status(400).json({ error: "User ID not found in token" });
        }

        // Try standard ObjectId match
        let transactions = await Transaction.find({ buyerId: userId }).sort({ createdAt: -1 });

        // Secondary attempt (plain string match if IDs were saved differently)
        if (transactions.length === 0) {
            transactions = await Transaction.find({ buyerId: userId.toString() }).sort({ createdAt: -1 });
        }

        console.log(`[PAYMENT] Found ${transactions.length} transactions for user ${userId}`);
        res.status(200).json(transactions);
    } catch (error) {
        console.error("Fetch Transactions Error:", error);
        res.status(500).json({ error: "Failed to fetch transaction history" });
    }
};

export const getAllTransactionsDebug = async (req, res) => {
    try {
        const transactions = await Transaction.find().limit(50).sort({ createdAt: -1 });
        res.status(200).json(transactions);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
