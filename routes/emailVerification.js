import express from "express"
import userModel from "../models/User.js"
import { welcomeEmail, sendVerificationEmail } from "../utils/Email.js"
import generateTokenAndSetCookies from "../utils/generateTokenAndSetCookies.js"
import { generateOTP } from "../utils/verifiacitonCode.js"
const router = express.Router()


router.post("/", async (req, res) => {
    try {
        const { code, email, language } = req.body;

        console.log(`🔍 Verification attempt for: ${email}`);
        console.log(`🔍 Received code: ${code}`);

        if (!email || !code) {
            return res.status(400).json({ msg: "Email and code are required" });
        }

        const user = await userModel.findOne({ email });

        if (!user) {
            console.log(`❌ User not found: ${email}`);
            return res.status(404).json({ msg: "User not found" });
        }

        console.log(`🔍 Stored code: ${user.verificationCode}`);
        console.log(`🔍 Code match: ${user.verificationCode == code}`);

        if (user.verificationCode == code) {
            user.isVerified = true;
            user.verificationCode = undefined;
            await user.save();

            const token = generateTokenAndSetCookies(res, user._id, email, user.name, user.role);

            console.log(`✅ User verified successfully: ${email}`);

            res.status(201).json({
                id: user._id,
                name: user.name,
                email: user.email,
                msg: "successfully registered",
                token,
            });

            // Send welcome email (don't await to avoid blocking)
            welcomeEmail(user.name, user.email, language).catch(err =>
                console.error('Welcome email failed:', err)
            );

        } else {
            console.log(`❌ Invalid code for ${email}. Expected: ${user.verificationCode}, Got: ${code}`);
            res.status(401).json({ msg: "Incorrect verification code" });
        }

    } catch (err) {
        console.error("Verification Error:", err);
        res.status(500).json({ msg: "Server error during verification" });
    }
})

// Resend OTP endpoint
router.post("/resend", async (req, res) => {
    try {
        const { email, language } = req.body;

        if (!email) {
            return res.status(400).json({ error: "Email is required" });
        }

        const user = await userModel.findOne({ email });

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        if (user.isVerified) {
            return res.status(400).json({ error: "Email already verified" });
        }

        // Generate new OTP
        const newVerificationCode = generateOTP();
        user.verificationCode = newVerificationCode;
        await user.save();

        // Send new OTP email
        try {
            await sendVerificationEmail(user.email, user.name, user.verificationCode, language);
            console.log(`✅ Resent OTP to ${user.email} (Lang: ${language})`);
            res.status(200).json({ message: "Verification code resent successfully" });
        } catch (emailError) {
            console.error(`⚠️ Failed to resend OTP to ${user.email}:`, emailError);
            res.status(500).json({
                error: "Failed to send verification email. Please try again later.",
                details: emailError.message
            });
        }

    } catch (err) {
        console.error("Resend OTP Error:", err);
        res.status(500).json({ error: "Server error during resend" });
    }
});

export default router