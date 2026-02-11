import jwt from "jsonwebtoken";
import User from "../models/User.js";

export const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({ message: "No token provided" });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
        req.user = null;
        return res.status(401).json({ message: "Invalid token format" });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Fetch fresh user data from DB to ensure role is up-to-date
        const user = await User.findById(decoded.id || decoded.userId || decoded._id).select('-password');

        if (!user) {
            return res.status(401).json({ message: "User not found" });
        }

        // Merge decoded user with fresh DB data (DB takes precedence for role)
        req.user = { ...decoded, ...user.toObject(), role: user.role };
        console.log(`[AUTH DEBUG] Token verified for: ${req.user.email} (Role: ${req.user.role})`);

        next();
    } catch (error) {
        console.error("Token verification failed:", error.message);
        return res.status(401).json({ message: "Invalid or expired token" });
    }
};

export const optionalVerifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        req.user = null;
        return next();
    }

    const token = authHeader?.split(" ")[1];

    if (!token || token === 'undefined' || token === 'null') {
        req.user = null;
        return next();
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
    } catch (error) {
        req.user = null;
    }
    next();
};
