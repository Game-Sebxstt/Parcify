import { getConnection } from "../utilities/database.js";
import { encrypt, generateCodeAuth, generateIdUser, generateDeviceCode } from "../utilities/globals.js";
import * as mail from "../utilities/mail.js";

const connection = await getConnection();

export const register = async (req, res, next) => {
    try {
        const { username, email, password } = req.body;
        const codeVerification = generateCodeAuth();

        const emailExist = await connection.query("SELECT email FROM users WHERE email = ?", [email]);
        if (emailExist.length > 0) {
            return res.status(400).json({ message: "El Correo Electronico ya existe." });
        }

        let id = await generateIdUser(connection);
        await connection.query("INSERT INTO users (user_id, username, email, password, active, auth_code, biography, profile_image, projects_collaborator) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", 
            [id, username, email, encrypt(password), false, codeVerification, "", "", "[]"]);

        mail.sendCodeVerification(email, codeVerification);

        res.status(200).json({ status: "Good request", message: "User register successful" });
    } catch (error) {
        next(error);
    }
}

export const login = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        const id = await connection.query("SELECT user_id FROM users WHERE email = ? AND password = ?", [email, encrypt(password)]);
        if (!id.length > 0) {
            return res.status(400).json({ status: "Bad Request", message: "El Usuario no existe." });
        }

        res.status(200).json({ status: "Good Request", message: id[0].user_id });
    } catch (error) {
        next(error);
    }
};

export const verifyCode = async (req, res, next) => {
    try {
        const { email, code } = req.body;

        const data_user = await connection.query("SELECT * FROM users WHERE email = ? AND auth_code = ?", [email, code]);

        if (!(data_user.length > 0)) {
            return res.status(400).json({ status: "Bad Request", message: "Code not found." });
        }

        const dataUpdated = await connection.query("UPDATE users SET active = true, auth_code = NULL WHERE email = ?", [email]);

        if (!dataUpdated) {
            return res.status(400).json({ status: "Bad Request", message: "Error in database." });
        }

        res.status(200).json({ status: "Good request", message: "User Active successful" });
    } catch (error) {
        next(error);
    }
};

export const cancelRegistration = async (req, res, next) => {
    try {
        const { email } = req.body;

        const deleteUser = await connection.query("DELETE FROM users WHERE email = ? AND active = false", [email]);
        if (deleteUser.affectedRows === 0) {
            return res.status(400).json({ status: "Bad Request", message: "User not found or user doesn't exist." });
        }

        res.status(200).json({ status: "Good Request", message: "User deleted successful" });
    } catch (error) {
        next(error);
    }
};

export const resendAuthCode = async (req, res, next) => {
    try {
        const { email } = req.body;
        const codeVerification = generateCodeAuth();

        const userExist = await connection.query("SELECT * FROM users WHERE email = ? AND active = false", [email]);

        if (!(userExist.length > 0)) {
            return res.status(400).json({ status: "Bad Request", message: "User doesn't exist." });
        }

        const updateCode = await connection.query("UPDATE users SET auth_code = ? WHERE email = ?", [codeVerification, email]);

        if (updateCode.affectedRows === 0) {
            return res.status(400).json({ status: "Bad Request", message: "Error in database." });
        }

        mail.sendCodeVerification(email, codeVerification);
        
        res.status(200).json({ status: "Good Request", message: "New code generated successful" });
    } catch (error) {
        next(error);
    }
};

export const registerDevice = async (req, res, next) => {
    try {
    const { id_user, device, country, date, type } = req.body;
    const device_id = generateDeviceCode();
    let devices = [];
    
    return res.status(200).send({ status: "Good Request", message: "New code generated succefull"});
    } catch (error) {
        next(error);
    }
};