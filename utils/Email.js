import {
  Verification_Email_Template,
  Welcome_Email_Template,
  Reset_Password_Email_Template,
  Reset_Password_OTP_Template,
  Password_Success_Template,
  EmailTranslations
} from "./EmailTemplate.js";
import { resend, transporter } from "./Email.config.js";
import { marketPlace } from "../consts.js";
//  console.log(transporter);

// SEND VERIFICATION EMAIL
export const sendVerificationEmail = async (email, name, verificationCode, language = 'en') => {
  try {
    console.log(`📧 Attempting to send verification email to: ${email} (Lang: ${language})`);
    console.log(`📧 From: A-Series <${process.env.EMAIL}>`);

    // Use the template function with language support
    const htmlContent = Verification_Email_Template(language, { name, verificationCode });

    const response = await resend.emails.send({
      from: `AI-MALL <${process.env.EMAIL}>`,
      to: [email],
      subject: EmailTranslations[language]?.verification?.subject || "Verify Your Email",
      html: htmlContent
    });

    console.log("✅ Verification email sent successfully:", response);
    return response;

  } catch (error) {
    console.error('❌ VERIFICATION EMAIL ERROR:', error);
    throw error; // Re-throw to let the caller know it failed
  }
}

// WELCOME EMAIL
export const welcomeEmail = async (name, email, language = 'en') => {
  try {
    const htmlContent = Welcome_Email_Template(language, { name, dashboardUrl: marketPlace });

    const response = await resend.emails.send({
      from: `AI-MALL <${process.env.EMAIL}>`,
      to: [email],
      subject: EmailTranslations[language]?.welcome?.subject || `Welcome ${name}`,
      html: htmlContent,
    });
    return response;
  } catch (error) {
    console.error('❌ WELCOME EMAIL ERROR:', error);
  }
};

// RESET PASSWORD LINK EMAIL
export const sendResetPasswordEmail = async (email, name, resetUrl, language = 'en') => {
  try {
    const htmlContent = Reset_Password_Email_Template(language, { name, resetUrl });

    const response = await resend.emails.send({
      from: `AI-MALL <${process.env.EMAIL}>`,
      to: [email],
      subject: "Reset Your Password",
      html: htmlContent
    })
    console.log("resend_msg", response);
  } catch (error) {
    console.log('Email error', error)
  }
}

// RESET PASSWORD OTP EMAIL
export const sendResetPasswordOTPEmail = async (email, name, otp, language = 'en') => {
  try {
    const htmlContent = Reset_Password_OTP_Template(language, { name, otp });

    const response = await resend.emails.send({
      from: `AI-MALL <${process.env.EMAIL}>`,
      to: [email],
      subject: EmailTranslations[language]?.resetOTP?.subject || "Password Reset OTP",
      html: htmlContent
    });
    console.log(`✅ Reset OTP email sent successfully to ${email}`);
    return response;
  } catch (error) {
    console.error('❌ RESET OTP EMAIL ERROR:', error);
    throw error;
  }
}

// PASSWORD RESET SUCCESS EMAIL
export const sendPasswordResetSuccessEmail = async (email, name, language = 'en') => {
  try {
    const htmlContent = Password_Success_Template(language, { name });

    const response = await resend.emails.send({
      from: `AI-MALL <${process.env.EMAIL}>`,
      to: [email],
      subject: EmailTranslations[language]?.passwordSuccess?.subject || "Password Updated Successfully",
      html: htmlContent
    });
    console.log(`✅ Reset success email sent successfully to ${email}`);
    return response;
  } catch (error) {
    console.error('❌ RESET SUCCESS EMAIL ERROR:', error);
    throw error;
  }
}


export const sendContactAdminEmail = async (adminEmail, vendorName, vendorEmail, subject, message) => {
  try {
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2 style="color: #2563eb;">New Admin Support Inquiry</h2>
        <p><strong>From:</strong> ${vendorName} (${vendorEmail})</p>
        <p><strong>Subject:</strong> ${subject}</p>
        <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p style="white-space: pre-wrap;">${message}</p>
        </div>
        <hr style="border: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 12px; color: #888;">This message was sent from the Vendor Dashboard.</p>
      </div>
    `;

    const response = await resend.emails.send({
      from: `AI-MALL System <${process.env.EMAIL}>`,
      to: [adminEmail],
      reply_to: vendorEmail,
      subject: `[Vendor Support] ${subject}`,
      html: htmlContent
    });
    console.log("Admin contact email sent:", response);
  } catch (error) {
    console.log('Admin contact email error:', error);
  }
}

