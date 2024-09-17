import { getConnection } from "../utilities/database.js";
const connection = await getConnection();

export const sendChatMessage = async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ state: false, message: "Body is empty" });
    }

    const { data, id_project } = req.body;

    try {
        const [project] = await connection.query("SELECT * FROM projects WHERE project_id = ?", [id_project]);

        if (!project) {
            return res.status(404).send({ status: "Not Found", message: "Project not found" });
        }

        const chat = project.chat_message ? JSON.parse(project.chat_message) : [];
        chat.push(data);

        const result = await connection.query("UPDATE projects SET chat_message = ? WHERE project_id = ?", [JSON.stringify(chat), id_project]);

        if (result.affectedRows === 0) {
            return res.status(400).send({ state: false, message: "Error al enviar el mensaje." });
        }

        return res.status(200).send({ state: true, message: "Mensaje enviado correctamente." });
    } catch (error) {
        console.error(error);
        return res.status(500).send({ status: "Internal Server Error", message: "An error occurred while processing your request." });
    }
};