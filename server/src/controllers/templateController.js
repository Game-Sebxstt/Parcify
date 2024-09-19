import { getConnection } from "../utilities/database.js";

const connection = await getConnection();

export const getAllTemplates = async (req, res) => {
    try {
        const data = await connection.query("SELECT * FROM templates ORDER BY date_create ASC");

        if (!data.length) {
            return res.status(400).send({ state: false, message: "No hay plantillas." });
        }

        res.status(200).send({ state: true, message: data });
    } catch (error) {
        console.error(error);
        res.status(500).send({ status: "Internal Server Error", message: "An error occurred while processing your request." });
    }
};

export const getTemplateById = async (req, res) => {
    const id_template = req.params.id_template;

    try {
        const [data] = await connection.query("SELECT * FROM templates WHERE template_id = ?", [id_template]);

        if (!data) {
            return res.status(400).send({ state: false, message: "La plantilla no existe." });
        }

        res.status(200).send({ state: true, message: data });
    } catch (error) {
        console.error(error);
        res.status(500).send({ status: "Internal Server Error", message: "An error occurred while processing your request." });
    }
};

export const likeTemplate = async (req, res) => {
    try {
        const { template_id, id_user } = req.body;

        const [template] = await connection.query("SELECT * FROM templates WHERE template_id = ?", [template_id]);
        if (!template) {
            return res.status(400).json({ state: false, message: "La plantilla no existe." });
        }

        let likes_template = JSON.parse(template.likes);
        likes_template.push({
            user_id: id_user,
            date: new Date()
        });

        const result = await connection.query("UPDATE templates SET likes = ? WHERE template_id = ?", [JSON.stringify(likes_template), template_id]);

        if (result.affectedRows === 0) {
            return res.status(400).json({ state: false, message: "No se pudo guardar el like." });
        }

        res.status(200).json({ state: true, message: likes_template });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: "Internal Server Error", message: "An error occurred while processing your request." });
    }
};

export const dislikeTemplate = async (req, res) => {
    try {
        const { template_id, id_user } = req.body;

        const [template] = await connection.query("SELECT * FROM templates WHERE template_id = ?", [template_id]);
        if (!template) {
            return res.status(400).json({ state: false, message: "La plantilla no existe." });
        }

        let likes_template = JSON.parse(template.likes);
        likes_template = likes_template.filter(like => like.user_id !== id_user);

        const result = await connection.query("UPDATE templates SET likes = ? WHERE template_id = ?", [JSON.stringify(likes_template), template_id]);

        if (result.affectedRows === 0) {
            return res.status(400).json({ state: false, message: "No se pudo guardar el dislike." });
        }

        res.status(200).json({ state: true, message: likes_template });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: "Internal Server Error", message: "An error occurred while processing your request." });
    }
};