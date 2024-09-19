import { getConnection } from "../utilities/database.js";
import { compareEncrypt, encrypt } from "../utilities/globals.js";

export const updateProfile = async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ state: false, message: "Body is empty" });
    }

    let {id, username, email, biography} = req.body;

    try {
        const connection = await getConnection();
        const [userExists] = await connection.query('SELECT * FROM users WHERE user_id = ?', [id]);

        if (userExists) {
            username = username || userExists.username;
            email = email || userExists.email;
            biography = biography || userExists.biography;

            await connection.query('UPDATE users SET username = ?, email = ?, biography = ? WHERE user_id = ?', [username, email, biography, id]);

            return res.status(200).send({ status: "Success", message: "Profile updated successfully" });
        }

        return res.status(404).send({ status: "Not Found", message: "User does not exist" });
    } catch (error) {
        console.error(error);
        return res.status(500).send({ status: "Internal Server Error", message: "An error occurred while processing your request." });
    }
};

export const updateImageProfile = async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ state: false, message: "Body is empty" });
    }
    const {userId, profileImage} = req.body;

    try {
        const connection = await getConnection();
        const [userExists] = await connection.query('SELECT * FROM users WHERE user_id = ?', [userId]);
        
        if (userExists){
            await connection.query('UPDATE users SET profile_image = ? WHERE user_id = ?', [profileImage, userId]);
            console.log("Se actualizó esta cosa");
            return res.status(200).send({status: "Success", message: "Profile image updated successfully"});  
        }
        console.log("No se encontró al usuario");
        return res.status(404).send({status: "Not Found", message: "User does not exist"});
    } catch (error) {
        console.error(error);
        return res.status(500).send({ status: "Internal Server Error", message: "An error occurred while processing your request." });
    }
};

export const checkPassword = async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ state: false, message: "Body is empty" });
    }

    const { user, password } = req.body;

    try {
        const connection = await getConnection();
        const [userExists] = await connection.query('SELECT * FROM users WHERE user_id = ?', [user]);

        if (userExists) {
            const isPasswordValid = compareEncrypt(password, userExists.password);
            
            if(isPasswordValid){
                return res.status(200).send({ status: "Success", message: isPasswordValid });
            } else {
                return res.status(401).send({ status: "Unauthorized", message: "Incorrect password" });
            }
        }
        return res.status(404).send({ status: "Not Found", message: "User does not exist" });
    } catch (error) {
        console.error(error);
        return res.status(500).send({ status: "Internal Server Error", message: "An error occurred while processing your request." });
    }
};

export const updatePassword = async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ state: false, message: "Body is empty" });
    }

    const { user, password } = req.body;

    try {
        const connection = await getConnection();
        const [userExists] = await connection.query('SELECT * FROM users WHERE user_id = ?', [user]);

        if (userExists) {
            const hashPassword = encrypt(password);

            const result = await connection.query('UPDATE users SET password = ? WHERE user_id = ?', [hashPassword, user]);

            if (result.affectedRows > 0) {            
                return res.status(200).send({ status: "Success", message: "Contraseña actualizada con éxito" });
            } else {
                return res.status(500).send({ status: "Error", message: "Error al actualizar la contraseña." });
            }
        } 
        return res.status(404).send({ status: "Not Found", message: "El Usuario no existe." }); 
    } catch (error) {
        console.error(error);
        return res.status(500).send({ status: "Internal Server Error", message: "An error occurred while processing your request." });
    }
};

export const getUserData = async (req, res) => {
    if (!req.query.id_user) {
        return res.status(400).send({ state: false, message: "User ID is required" });
    }

    const id_user = req.query.id_user;

    try {
        const connection = await getConnection();
        const [data] = await connection.query("SELECT * FROM users WHERE user_id = ?", [id_user]);
        const projects = await connection.query("SELECT * FROM projects WHERE user_id = ?", [id_user]);
        const templates = await connection.query("SELECT * FROM templates");

        if (!data && !projects.length && !templates.length) {
            return res.status(400).send({ state: false, message: "El Usuario no existe." });
        }

        if (data) {
            delete data.password;
        }

        const info_user = {
            users: data,
            projects: projects,
            templates: templates
        };

        res.status(200).send({ state: true, message: info_user });
    } catch (error) {
        console.error(error);
        return res.status(500).send({ status: "Internal Server Error", message: "An error occurred while processing your request." });
    }
};

export const getUserProjects = async (req, res) => {
    if (!req.query.id_user) {
        return res.status(400).send({ state: false, message: "User ID is required" });
    }

    const id_user = req.query.id_user;

    try {
        const connection = await getConnection();
        const data = await connection.query("SELECT * FROM projects WHERE user_id = ?", [id_user]);

        if (!data.length) {
            return res.status(400).send({ state: false, message: "El Usuario no tiene proyectos." });
        }

        res.status(200).send({ state: true, message: data });
    } catch (error) {
        console.error(error);
        return res.status(500).send({ status: "Internal Server Error", message: "An error occurred while processing your request." });
    }
};

export const getProjectsAsCollaborator = async (req, res) => {
    if (!req.query.id_user) {
        return res.status(400).send({ state: false, message: "User ID is required" });
    }

    const id_user = req.query.id_user;

    try {
        const connection = await getConnection();
        const data = await connection.query("SELECT * FROM projects WHERE collaborators LIKE ?", [`%${id_user}%`]);

        if (!data.length) {
            return res.status(400).send({ state: false, message: "El Usuario no tiene proyectos como colaborador." });
        }

        res.status(200).send({ state: true, message: data });
    } catch (error) {
        console.error(error);
        return res.status(500).send({ status: "Internal Server Error", message: "An error occurred while processing your request." });
    }
};

export const getProjectById = async (req, res) => {
    if (!req.query.id_project) {
        return res.status(400).send({ state: false, message: "Project ID is required" });
    }

    const id_project = req.query.id_project;

    try {
        const connection = await getConnection();
        const [data] = await connection.query("SELECT * FROM projects WHERE project_id = ?", [id_project]);

        if (!data) {
            return res.status(400).send({ state: false, message: "El Proyecto no existe." });
        }

        res.status(200).send({ state: true, message: data });
    } catch (error) {
        console.error(error);
        return res.status(500).send({ status: "Internal Server Error", message: "An error occurred while processing your request." });
    }
};

export const sendInvitationProject = async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ state: false, message: "Body is empty" });
    }

    const { id_project, invitation, role } = req.body;

    const invitationObject = {
        invitation: invitation,
        role: role
    }

    const connection = await getConnection();
    const update_invitation = await connection.query("UPDATE projects SET invitation = ? WHERE project_id = ?", [JSON.stringify(invitationObject), id_project]);

    if (!update_invitation) {
        return res.status(400).send({ state: false, message: "No se pudo enviar la invitación." });
    }

    return res.status(200).send({ state: true, message: "Invitación enviada correctamente." });
}

export const getPreferencesUser = async (req, res) => {
    if (!req.query.id_user) {
        return res.status(400).send({ state: false, message: "User ID is required" });
    }

    const id_user = req.query.id_user;

    try {
        const connection = await getConnection();
        const [data] = await connection.query("SELECT * FROM preferences WHERE user_id = ?", [id_user]);

        if (!data) {
            return res.status(400).send({ state: false, message: "No hay preferencias." });
        }

        res.status(200).send({ state: true, message: data });
    } catch (error) {
        console.error(error);
        return res.status(500).send({ status: "Internal Server Error", message: "An error occurred while processing your request." });
    }
}

export const getPrimaryData = async (req, res) => {
    if (!req.query.id_user) {
        return res.status(400).send({ state: false, message: "User ID is required" });
    }

    const id_user = req.query.id_user;

    try {
        const connection = await getConnection();
        const user_get = await connection.query("SELECT * FROM users WHERE user_id = ?", [id_user]);
        const templates_get = await connection.query("SELECT * FROM templates ORDER BY date_create ASC");
        const favorites_get = await connection.query("SELECT favorites FROM preferences WHERE user_id = ?", [id_user]);
        const projects_get = await connection.query("SELECT * FROM projects");

        const data = {
            user: user_get,
            templates: templates_get,
            favorites: favorites_get,
            projects: projects_get
        };

        res.status(200).send({ state: true, message: data });
    } catch (error) {
        console.error(error);
        return res.status(500).send({ status: "Internal Server Error", message: "An error occurred while processing your request." });
    }
}