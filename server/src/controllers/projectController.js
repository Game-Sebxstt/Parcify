import { getConnection } from "../utilities/database.js";
import { generateIdProject } from "../utilities/globals.js";

const connection = await getConnection();

export const createProject = async (req, res, next) => {
    try {
        const { id, name, template_id } = req.body;

        const userExist = await connection.query("SELECT user_id FROM users WHERE user_id = ?", [id]);

        if (!userExist.length > 0) {
            return res.status(400).json({ state: false, message: "El Usuario no existe." });
        }

        let template = await connection.query("SELECT stage, preview FROM templates WHERE template_id = ?", [template_id]);
        
        if (!template.length > 0) {
            template = [{ stage: "", preview: "" }];
        }

        const dataUser = await connection.query("SELECT * FROM users WHERE user_id = ?", [id]);
        const project_id = await generateIdProject(connection);
        const date_now = new Date();
        const collaborators = [{
            user_id: id,
            project_id: project_id,
            name: dataUser[0].username,
            role: "owner",
            commits: [],
            last_commit: "",
            last_access: "",
            time_worked: [],
            pages_created: 0,
            elements_created: 0,
            elements_deleted: 0,
            groups_created: 0,
            group_deleted: 0,
            plugins_used: 0,
            color: {
                tailwind: "blue-500",
                hex: "#3B82F6",
            },
            state: false
        }];

        const data = await connection.query(
            "INSERT INTO projects (project_id, user_id, name, preview, stage, collaborators, last_modified, create_date, chat_message, invitation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [project_id, id, name, template[0].preview, template[0].stage, JSON.stringify(collaborators), date_now, date_now, "", ""]
        );

        if (!data) {
            return res.status(400).json({ state: false, message: "No se pudo crear el proyecto" });
        }

        res.status(200).json({
            state: "Good Request",
            message: {
                project_id: project_id,
                stage: template[0].stage,
                preview: template[0].preview,
                collaborators: collaborators,
                last_modified: date_now
            }
        });
    } catch (error) {
        next(error);
    }
};

export const deleteProject = async (req, res, next) => {
    try {
        const { id_project } = req.body;

        const data = await connection.query("DELETE FROM projects WHERE project_id = ?", [id_project]);

        if (!data) {
            return res.status(400).json({ state: false, message: "No se pudo eliminar el proyecto." });
        }

        res.status(200).json({ state: true, message: "El proyecto se eliminó correctamente." });
    } catch (error) {
        next(error);
    }
};

export const deleteProjectList = async (req, res, next) => {
    try {
        const { list_projects } = req.body;

        for (const element of list_projects) {
            const delete_project = await connection.query("DELETE FROM projects WHERE project_id = ?", [element]);

            if (!delete_project) {
                return res.status(400).json({ state: false, message: "No se pudo eliminar el proyecto." });
            }
        }

        res.status(200).json({ state: true, message: "Los proyectos se eliminaron correctamente." });
    } catch (error) {
        next(error);
    }
};

export const duplicateProject = async (req, res, next) => {
    try {
        const { id_project } = req.body;

        const data = await connection.query("SELECT * FROM projects WHERE project_id = ?", [id_project]);

        if (!data.length > 0) {
            return res.status(400).json({ state: false, message: "El Proyecto no existe." });
        }

        const project_id = await generateIdProject(connection);
        const date_now = new Date();
        const duplicate = await connection.query(
            "INSERT INTO projects (project_id, user_id, name, stage, chat_message, preview, collaborators, last_modified) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [project_id, data[0].user_id, data[0].name, data[0].stage, data[0].chat_message, data[0].preview, data[0].collaborators, date_now]
        );

        if (!duplicate) {
            return res.status(400).json({ state: false, message: "No se pudo duplicar el proyecto." });
        }

        res.status(200).json({
            state: true,
            message: {
                project_id: project_id,
                stage: data[0].stage,
                preview: data[0].preview,
                collaborators: data[0].collaborators,
                name: data[0].name,
                last_modified: date_now
            }
        });
    } catch (error) {
        next(error);
    }
};

export const duplicateProjectList = async (req, res, next) => {
    try {
        const { list_projects } = req.body;
        let returnData = [];

        for (const element of list_projects) {
            const data = await connection.query("SELECT * FROM projects WHERE project_id = ?", [element]);

            if (!data.length > 0) {
                throw new Error(`El Proyecto ${element} no existe.`);
            }

            const project_id = await generateIdProject(connection);
            const date_now = new Date();

            returnData.push({
                project_id: project_id,
                stage: data[0].stage,
                preview: data[0].preview,
                collaborators: data[0].collaborators,
                name: data[0].name
            });

            const duplicate = await connection.query(
                "INSERT INTO projects (project_id, user_id, name, stage, preview, collaborators, last_modified) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [project_id, data[0].user_id, data[0].name, data[0].stage, data[0].preview, data[0].collaborators, date_now]
            );

            if (!duplicate) {
                throw new Error(`No se pudo duplicar el proyecto con ID ${element}.`);
            }
        }

        res.status(200).json({ state: true, message: returnData });
    } catch (error) {
        next(error);
    }
};

export const renameProject = async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ state: false, message: "Body is empty" });
    }
    const { id_project, name } = req.body;

    try {
        const [data] = await connection.query("SELECT * FROM projects WHERE project_id = ?", [id_project]);

        if (data && data.length === 0) {
            return res.status(400).send({ state: false, message: "El Proyecto no existe." });
        }

        const result = await connection.query("UPDATE projects SET name = ? WHERE project_id = ?", [name, id_project]);

        if (result.affectedRows === 0) {
            return res.status(400).send({ state: false, message: "No se pudo cambiar el nombre al proyecto." });
        }

        return res.status(200).send({ state: true, message: "Nombre del proyecto actualizado correctamente." });
    } catch (error) {
        console.error(error);
        return res.status(500).send({ status: "Internal Server Error", message: "An error occurred while processing your request." });
    }
};

export const saveProject = async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ state: false, message: "Body is empty" });
    }
    const {stage, project_id, preview} = req.body;

    try {
        const dateCommit = new Date();
        
        const update_project = await connection.query("UPDATE projects SET stage = ?, preview = ?, last_modified = ? WHERE project_id = ?", [stage, preview, dateCommit, project_id]);

        if(!update_project){
            return res.status(400).send({ state: false, message: "No se pudo guardar el proyecto." });
        }

        return res.status(200).send({ state: true, message: "El proyecto se guardo correctamente." });
    } catch (error) {
        console.error(error);
        return res.status(500).send({ status: "Internal Server Error", message: "An error occurred while processing your request." });
    }
};

export const saveCollaborators = async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ state: false, message: "Body is empty" });
    }

    const { project_id, collaborators } = req.body;

    try {
        const [collaboratorsProjectResult] = await connection.query("SELECT collaborators FROM projects WHERE project_id = ?", [project_id]);

        if(!collaboratorsProjectResult){
            return res.status(400).send({ state: false, message: "No se pudo encontrar el proyecto."});
        }

        const existingCollaborators = JSON.parse(collaboratorsProjectResult.collaborators);
        let updated = false;

        existingCollaborators.forEach((element) => {
            if (element.user_id == collaborators.user_id) {
                Object.assign(element, collaborators);
                updated = true;
            }
        });

        if (!updated) {
            console.log("No se actualizó ningún colaborador, se añadirá uno nuevo.");
            existingCollaborators.push(collaborators);
        }

        const updateCollaborators = await connection.query("UPDATE projects SET collaborators = ? WHERE project_id = ?", [JSON.stringify(existingCollaborators), project_id]);

        if (!updateCollaborators) {
            return res.status(400).send({ state: false, message: "No se pudo guardar los colaboradores." });
        }

        const [existingsProjectsCollaboratorResult] = await connection.query("SELECT projects_collaborator FROM users WHERE user_id = ?", [collaborators.user_id]);

        if (!existingsProjectsCollaboratorResult) {
            return res.status(400).send({ state: false, message: "No se pudo encontrar el usuario." });
        }

        const projectsCollaborator = JSON.parse(existingsProjectsCollaboratorResult.projects_collaborator || "[]");

        const existingCollaborator = projectsCollaborator.find(collaboratorItem => collaboratorItem == project_id);

        if (existingCollaborator) {
            return res.status(200).send({ state: true, message: "Los colaboradores se guardaron correctamente." });
        }

        projectsCollaborator.push(project_id);

        const updateCollaboratorUser = await connection.query("UPDATE users SET projects_collaborator = ? WHERE user_id = ?", [JSON.stringify(projectsCollaborator), collaborators.user_id]);

        if (!updateCollaboratorUser) {
            return res.status(400).send({ state: false, message: "No se pudo guardar los colaboradores." });
        }

        return res.status(200).send({ state: true, message: "Los colaboradores se guardaron correctamente." });
    } catch (error) {
        console.error(error);
        return res.status(500).send({ status: "Internal Server Error", message: "An error occurred while processing your request." });
    }
};

export const getProjectCollaborators = async (req, res) => {
    const project_id = req.query.id_project;

    try {
        const collaboratorsProject = await connection.query("SELECT * FROM projects WHERE project_id = ?", [project_id]);

        if (!collaboratorsProject.length) {
            return res.status(404).send({ status: "Not Found", message: "Proyecto no encontrado." });
        }

        let data = JSON.parse(collaboratorsProject[0].collaborators || "[]")

        if (!data || data.length === 0) {
            return res.status(404).send({ status: "Not Found", message: "No hay colaboradores en el proyecto." });
        }

        res.status(200).send({ state: true, collaborators: data });

    } catch (error) {
        console.error(error);
        res.status(500).send({ status: "Internal Server Error", message: "Error al conectar con la base de datos." });
    }
}

export const getProjectsGlobal = async (req, res) => {
    try {
        const projects = await connection.query("SELECT * FROM projects");

        if (!projects.length) {
            return res.status(404).send({ status: "Not Found", message: "No hay proyectos." });
        }

        res.status(200).send({ state: true, projects: projects });

    } catch (error) {
        console.error(error);
        res.status(500).send({ status: "Internal Server Error", message: "Error al conectar con la base de datos." });
    }
}
