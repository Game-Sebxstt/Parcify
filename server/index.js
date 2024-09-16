import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import CryptoJS from 'crypto-js';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import bodyParser from 'body-parser';
import { getConnection } from "./utilities/database.js";
import * as socket_logic from './utilities/socket-logic.js'

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });
const port = process.env.PORT || 4000;

// Configuración inicial
app.set("port", port);

// Middlewares
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '100mb' }));

app.use(cors({
    origin: ['https://parcify.vercel.app', 'http://localhost:4321'], // Orígenes permitidos
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Métodos permitidos
    allowedHeaders: ['Content-Type', 'client-id', 'X-Requested-With'], // Encabezados permitidos
    credentials: true // Permitir el envío de cookies
}));

app.use(function (req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
    res.setHeader('Access-Control-Allow-Credentials', true);
    next();
});

app.use(morgan("dev"));
app.use(express.json());

const clients = new Map();
wss.on('connection', function connection(ws) {
    ws.on('message', function incoming(message) {
        const data = JSON.parse(message);
        socket_logic.initSocket(data, ws, clients);
    });

    ws.on('close', function () {
        socket_logic.finishSocket(ws, clients);
    });
});


server.listen(app.get("port"));
console.log(`Servidor en el puerto ${app.get("port")}`);

app.get("/", (req, res) => {
    res.send({
        message: "Hello World!",
        clients: clients
    });
});

app.post("/invitation/send", async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" });
    }

    const { id_project, invitation, role } = req.body;

    const invitationObject = {
        invitation: invitation,
        role: role
    }

    const connection = await getConnection();
    const update_invitation = await connection.query("UPDATE projects SET invitation = ? WHERE project_id = ?", [JSON.stringify(invitationObject), id_project]);

    if (!update_invitation) {
        return res.status(400).send({ status: "Bad Request", message: "No se pudo enviar la invitación." });
    }

    return res.status(200).send({ status: "Good Request", message: "Invitación enviada correctamente." });
})

app.post('/register/auth', async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty"});
    }

    const { username, email, password } = req.body;
    const connection = await getConnection();

    const emailExist = await connection.query("SELECT email FROM users WHERE email = ?", [email]);
    if (emailExist.length > 0) {
        return res.status(400).json({ message: "El Correo Electronico ya existe." })
    }

    let id = await generateIdUser(connection);
    const send_data = await connection.query("INSERT INTO users (user_id, username, email, password, biography, profile_image) VALUES (?, ?, ?, ?, ?, ?)", [id, username, email, encrypt(password), "", ""]);

    if (!send_data) {
        return res.status(400).json({ message: "Error in the database" })
    }

    res.status(200).send({ status: "Good request", message: "User register successfull" })
});

app.post('/login/auth', async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" })
    }

    const { email, password } = req.body;
    const connection = await getConnection();

    const id = await connection.query("SELECT user_id FROM users WHERE email = ? AND password = ?", [email, encrypt(password)]);
    if (!id.length > 0) {
        return res.status(400).send({ status: "Bad Request", message: "El Usuario no existe." })
    }

    res.status(200).send({ status: "Good Request", message: id[0].user_id })
});

app.post("/project/create", async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" })
    }

    const { id, name, template_id} = req.body;

    const connection = await getConnection();
    const userExist = await connection.query("SELECT user_id FROM users WHERE user_id = ?", [id]);

    if(!userExist.length > 0){
        return res.status(400).send({ status: "Bad Request", message: "El Usuario no existe." })
    }

    let template = await connection.query("SELECT stage, preview FROM templates WHERE template_id = ?", [template_id]);
    
    if(!template.length > 0){
        template = [
            {
                stage: "",
                preview: ""
            }
        ]
    }

    const dataUser = await connection.query("SELECT * FROM users WHERE user_id = ?", [id]);
    const project_id = await generateIdProject(connection);
    const date_now = new Date();
    const collaborators = [
        {
            user_id: id,
            project_id: project_id,
            name: dataUser[0].username,
            role: "owner",
            commits: [],
            last_commit: "",
            last_access: "",
            time_worked: [],
            pages_created: 0,
            elements_used: 0,
            plugins_used: 0,
            color: {
                tailwind: "blue-500",
                hex: "#3B82F6",
            },
            state: false
        },
    ];

    const data = await connection.query("INSERT INTO projects (project_id, user_id, name, preview, stage, collaborators, last_modified, create_date, chat_message, invitation) VALUES (? ,?, ?, ?, ?, ?, ?, ?, ?, ?)",[project_id, id, name, template[0].preview, template[0].stage, JSON.stringify(collaborators), date_now, date_now, "", ""]);

    if (!data) {
        return res.status(400).send({ status: "Bad Request", message: "No se pudo crear el proyecto" })
    }

    return res.status(200).send({state: "Good Request", message: {project_id: project_id, stage: template[0].stage, preview: template[0].preview, collaborators: collaborators}})
})

app.post("/project/delete", async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" })
    }

    const { id_project } = req.body;

    const connection = await getConnection();
    const data = await connection.query("DELETE FROM projects WHERE project_id = ?", [id_project]);

    if(!data){
        return res.status(400).send({ status: "Bad Request", message: "No se pudo eliminar el proyecto." })
    }

    return res.status(200).send({ status: "Good Request", message: "El proyecto se elimino correctamente." })
})

app.post("/project/deleteList", async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" })
    }

    const { list_projects } = req.body;

    const connection = await getConnection();

    list_projects.forEach(async (element) => {
        const delete_project = await connection.query("DELETE FROM projects WHERE project_id = ?", [element]);

        if(!delete_project){
            return res.status(400).send({ status: "Bad Request", message: "No se pudo eliminar el proyecto." })
        }
    });

    return res.status(200).send({ status: "Good Request", message: "Los proyectos se eliminaron correctamente."})
});

app.post("/project/duplicate", async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" })
    }

    const { id_project } = req.body;

    const connection = await getConnection();
    const data = await connection.query("SELECT * FROM projects WHERE project_id = ?", [id_project]);

    if(!data.length > 0){
        return res.status(400).send({ status: "Bad Request", message: "El Proyecto no existe." })
    }

    const project_id = await generateIdProject(connection);
    const date_now = new Date();
    const duplicate = await connection.query("INSERT INTO projects (project_id, user_id, name, stage, chat_message, preview, collaborators, last_modified) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",[project_id, data[0].user_id, data[0].name, data[0].stage, data[0].chat_message, data[0].preview, data[0].collaborators, date_now]);

    if(!duplicate){
        return res.status(400).send({ status: "Bad Request", message: "No se pudo duplicar el proyecto." })
    }

    return res.status(200).send({ status: "Good Request", message: {project_id: project_id, stage: data[0].stage, preview: data[0].preview, collaborators: data[0].collaborators, name: data[0].name} })
})

app.post("/project/duplicateList", async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" });
    }

    const { list_projects } = req.body;

    const connection = await getConnection();
    let returnData = [];

    try {
        await Promise.all(list_projects.map(async (element) => {
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
        }));

        return res.status(200).send({ status: "Good Request", message: returnData });
    } catch (error) {
        return res.status(400).send({ status: "Bad Request", message: error.message });
    }
});

app.post("/template/like", async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" })
    }
    const { template_id, id_user } = req.body;
    const connection = await getConnection();

    const template = await connection.query("SELECT * FROM templates WHERE template_id = ?", [template_id]);
    if (!template.length > 0) {
        return res.status(400).send({ status: "Bad Request", message: "La plantilla no existe." });
    }

    let likes_template = JSON.parse(template[0].likes)
    likes_template.push({
        user_id: id_user,
        date: new Date()
    })

    const saved_template = await connection.query("UPDATE templates SET likes = ? WHERE template_id = ?",[JSON.stringify(likes_template), template_id]);

    if (!saved_template) {
        return res.status(400).send({ status: "Bad Request", message: "No se pudo guardar el like." });
    }

    return res.status(200).send({ status: "Good Request", message: "Like guardado correctamente." });
})

app.post("/template/dislike", async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" })
    }
    const { template_id, id_user } = req.body;
    const connection = await getConnection();

    const template = await connection.query("SELECT * FROM templates WHERE template_id = ?", [template_id]);
    if (!template.length > 0) {
        return res.status(400).send({ status: "Bad Request", message: "La plantilla no existe." });
    }

    let likes_template = JSON.parse(template[0].likes)
    likes_template = likes_template.filter(like => like.user_id !== id_user);

    const saved_template = await connection.query("UPDATE templates SET likes = ? WHERE template_id = ?",[JSON.stringify(likes_template), template_id]);

    if (!saved_template) {
        return res.status(400).send({ status: "Bad Request", message: "No se pudo guardar el dislike." });
    }

    return res.status(200).send({ status: "Good Request", message: "Dislike guardado correctamente." });
})

//Cambio de nombre
app.post("/project/rename", async (req,res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" })
    }
    const { id_project, name } = req.body;

    const connection = await getConnection();
    const [data] = await connection.query("SELECT * FROM projects WHERE project_id = ?", [id_project]);

    if (data && data.length === 0) {
        return res.status(400).send({ status: "Bad Request", message: "El Proyecto no existe." });
    }

    const result = await connection.query("UPDATE projects SET name = ? WHERE project_id = ?", [name, id_project]);

    if (result.affectedRows === 0) {
        return res.status(400).send({ status: "Bad Request", message: "No se pudo cambiar el nombre al proyecto." });
    }

    return res.status(200).send({ status: "Good Request", message: "Nombre del proyecto actualizado correctamente." });
})

app.post("/project/save", async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" })
    }
    const {stage, project_id, preview, user_id} = req.body;

    const dateCommit = new Date();

    const connection = await getConnection();
    const update_project = await connection.query("UPDATE projects SET stage = ?, preview = ?, last_modified = ? WHERE project_id = ?", [stage, preview, dateCommit, project_id]);

    if(!update_project){
        return res.status(400).send({ status: "Bad Request", message: "No se pudo guardar el proyecto." })
    }

    const collaborators = await connection.query("SELECT collaborators FROM projects WHERE project_id = ?", [project_id]);
    const data = JSON.parse(collaborators[0].collaborators);

    data.forEach(async (element) => {
        if(element.user_id != user_id) return;

        const existingEntry = element.commits.find(entry => entry.date.split("T")[0] === dateCommit.toISOString().split("T")[0]);

        if (existingEntry) {
            existingEntry.commits += 1;
        } else {
            element.commits.push({
                date: dateCommit,
                commits: 1,
            });
        }

        element.last_commit = dateCommit;
    });

    const update_collaborators = await connection.query("UPDATE projects SET collaborators = ? WHERE project_id = ?", [JSON.stringify(data), project_id]);

    if(!update_collaborators){
        return res.status(400).send({ status: "Bad Request", message: "No se pudo guardar el proyecto." })
    }

    return res.status(200).send({ status: "Good Request", message: "El proyecto se guardo correctamente." })
});

//Save collaborators of project
app.post("/project/collaborators", async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" });
    }

    const connection = await getConnection();
    const { project_id, collaborators } = req.body;

    const collaboratorsProject = await connection.query("SELECT collaborators FROM projects WHERE project_id = ?", [project_id]);

    if(!collaboratorsProject.length > 0){
        return res.status(400).send({ status: "Bad Request", message: "No se pudo encontrar el proyecto."});
    }

    const existingCollaborators = JSON.parse(collaboratorsProject[0].collaborators);
    let collaboratorUpdate;
    let updated = false;

    existingCollaborators.forEach((element, index) => {
        if (element.user_id == collaborators.user_id) {
            element.role = collaborators.role || element.role;
            element.commits = collaborators.commits || element.commits;
            element.last_commit = collaborators.last_commit || element.last_commit;
            element.last_access = collaborators.last_access || element.last_access;
            element.time_worked = collaborators.time_worked || element.time_worked;
            element.pages_created = collaborators.pages_created || element.pages_created;
            element.elements_used = collaborators.elements_used || element.elements_used;
            element.plugins_used = collaborators.plugins_used || element.plugins_used;
            element.color = collaborators.color || element.color;
            element.state = collaborators.state != undefined ? collaborators.state : element.state;
            collaboratorUpdate = element;
            updated = true;
        }
    });


    if (!updated) {
        console.log("No se actualizó ningún colaborador, se añadirá uno nuevo.");
        existingCollaborators.push(collaborators);
    }

    console.log("Colaboradores actualizados:", collaboratorUpdate);

    const updateCollaborators = await connection.query("UPDATE projects SET collaborators = ? WHERE project_id = ?", [JSON.stringify(existingCollaborators), project_id]);

    if (!updateCollaborators) {
        return res.status(400).send({ status: "Bad Request", message: "No se pudo guardar los colaboradores." });
    }

    return res.status(200).send({ status: "Good Request", message: "Los colaboradores se guardaron correctamente." });
});

app.post("/preferences/favorite", async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" })
    }

    const {id, id_project, type} = req.body;
    const connection = await getConnection();

    let favorites = [];

    const userExist = await connection.query("SELECT * FROM preferences WHERE user_id = ?", [id]);

    if (userExist.length > 0) {
        let actualFavorite = userExist[0].favorites ? JSON.parse(userExist[0].favorites) : [];

        if (!Array.isArray(actualFavorite)) {
            actualFavorite = [];
        }

        const isDuplicate = actualFavorite.some(fav => fav.id === id_project && fav.type === type);

        if (isDuplicate) {
            return res.status(200).send({ status: "Bad Request", message: "Favorite already exists" });
        }

        actualFavorite.push({ id: id_project, type: type});

        const newFavorites = JSON.stringify(actualFavorite);
        const updateFavorite = await connection.query("UPDATE preferences SET favorites = ? WHERE user_id = ?",[newFavorites, id]);

        if(!updateFavorite){
            return res.status(400).send({ status: "Bad Request", message: "No se pudo guardar el favorito." })
        }
    } else {
        favorites.push({ id: id_project, type: type});

        const newFavorites = JSON.stringify(favorites);
        const addFavorite = await connection.query(`INSERT INTO preferences (user_id, favorites) VALUES (?, ?)`, [id, newFavorites]);

        if(!addFavorite){
            return res.status(400).send({ status: "Bad Request", message: "No se pudo guardar el favorito." })
        }
    }

    return res.status(200).send({ status: "Good Request", message: "Favorito guardado correctamente." });

});

//Update profile
app.post("/user/updateProfile", async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" });
    }

    let {id, username, email, biography} = req.body;
    const connection = await getConnection();

    const userExists = await connection.query('SELECT * FROM users WHERE user_id = ?', [id]);

    if (userExists.length > 0) {
        username = username || userExists[0].username;
        email = email || userExists[0].email;
        biography = biography || userExists[0].biography;

        await connection.query('UPDATE users SET username = ?, email = ?, biography = ? WHERE user_id = ?', [(username), email, biography, id]);

        return res.status(200).send({ status: "Success", message: "Profile updated successfully" });
    }

    return res.status(404).send({ status: "Not Found", message: "User does not exist" });
})

//Update username
app.post("/user/updateUsername", async (req,res) =>{
    if (!req.body){
        return res.status(400).send({status: "Bad Request", message: "Body is empty"})
    }
    const {id, username} = req.body;
    const connection = await getConnection();
    
    const userExists = await connection.query('Select * FROM users WHERE user_id = ?', [id]);
    
    if (userExists.length > 0){
        await connection.query('UPDATE users SET username = ? WHERE user_id = ?', [username, id]);
        
        return res.status(200).send({status: "Success", message: "Username updated successfully"});   
    }
    
    return res.status(404).send({status: "Not Found", message: "User does not exist"});
})

//Update profile image
app.post("/user/updateImageProfile", async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" });
    }
    const {userId, profileImage} = req.body;
    const connection = await getConnection();

    const userExists = await connection.query('Select * FROM users WHERE user_id = ?', [userId]);
    
    if (userExists.length > 0){
        await connection.query('UPDATE users SET profile_image = ? WHERE user_id = ?', [profileImage, userId]);
        console.log("Se actualizó esta cosa");
        return res.status(200).send({status: "Success", message: "Profile image updated successfully"});  
    }
    console.log("No se encontró al usuario");
    return res.status(404).send({status: "Not Found", message: "User does not exist"});
})

//Check profile image
app.post("/user/getProfileImage", async (req, res) => {
    if (!req.body) {
      return res.status(400).send({ status: "Bad Request", message: "Body is empty" });
    }
  
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).send({ state: false, message: "User ID is required" });
    }
  
    const connection = await getConnection();
    
    // Consulta para obtener la imagen de perfil
    connection.query("SELECT profile_image FROM users WHERE user_id = ?", [userId], (error, results) => {
        if (error) {
            return res.status(500).send({ state: false, message: "Internal Server Error" });
        }
    
        if (results.length > 0) {
            return res.status(200).send({ state: true, profileImage: results[0].profile_image });
        }

        return res.status(404).send({ state: false, message: "User does not exist" });
    });
});

//Verify 
app.post('/user/checkPassword', async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" });
    }

    const { user, password } = req.body;
    const connection = await getConnection();

    const [userExists] = await connection.query('SELECT * FROM users WHERE user_id = ?', [user]);

    if (userExists) {
        const isPasswordValid = compareEncrypt(password, userExists.password);
        
        if(isPasswordValid){
            return res.status(200).send({ status: "Success", message: isPasswordValid });
        }else{
            return res.status(401).send({ status: "Unauthorized", message: "Incorrect password" });
        }
    }
    return res.status(404).send({ status: "Not Found", message: "User does not exist" });
});

//Update password
app.post("/user/updatePassword", async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" });
    }

    const { user, password } = req.body;
    const connection = await getConnection();

    const userExists = await connection.query('SELECT * FROM users WHERE user_id = ?', [user]);

    if (userExists.length > 0) {
        const hashPassword = encrypt(password);

        const result = await connection.query('UPDATE users SET password = ? WHERE user_id = ?', [hashPassword, user]);

        if (result.affectedRows > 0) {            
            return res.status(200).send({ status: "Success", message: "Contraseña actualizada con éxito" });
        } else {
            return res.status(500).send({ status: "Error", message: "Error al actualizar la contraseña." });
        }
    } 
    return res.status(404).send({ status: "Not Found", message: "El Usuario no existe." }); 
});

//Update biography
app.post("/user/updateBiography", async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" });
    }

    const {id, biography} = req.body;
    const connection = await getConnection();

    const userExist = await connection.query("SELECT * FROM users WHERE user_id = ?",[id]);
    
    if (userExist.length > 0) {
        await connection.query("UPDATE users SET biography = ? WHERE user_id = ?", [biography, id]);

        return res.status(200).send({ status: "Good Request", message: "Biografía actualizada con éxito" });
    }
    
    return res.status(404).send({ status: "Not Found", message: "User does not exist" });
});

// Verificar el email
app.post("/user/checkEmail", async (req, res)  => {
    if (!req.body) {
        return res.status(400).send({status: "Bad Request", message: "Body is empty"})
    }
    
    const {id, email} = req.body;

    const connection = await getConnection();
    
    const [userExists] = await connection.query("SELECT * FROM users WHERE user_id = ?", [id]) 
    
    if (userExists) {
        if (email === userExists.email) {

            return res.status(200).send({ status: "Good Request", message: userExists.email })
        }else{

            return res.status(400).send({ status: "Bad Request", message: "El email no coincide con el del usuario." })
        }
    }
    return res.status(404).send({ status: "Not Found", message: "User does not exist" });
});

//Chat
app.post("/chat/send", async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" });
    }

    const { data, id_project } = req.body;

    const connection = await getConnection();
    const [project] = await connection.query("SELECT * FROM projects WHERE project_id = ?", [id_project]);

    if (!project) {
        return res.status(404).send({ status: "Not Found", message: "Project not found" });
    }

    const chat = project.chat_message ? JSON.parse(project.chat_message) : [];
    chat.push(data);

    const updateChat = await connection.query("UPDATE projects SET chat_message = ? WHERE project_id = ?", [JSON.stringify(chat), id_project]);

    if (!updateChat) {
        return res.status(400).send({ status: "Bad Request", message: "Error al enviar el mensaje." });
    }

    return res.status(200).send({ status: "Good Request", message: "Mensaje enviado correctamente." });
})

app.get("/user/data", async (req, res) =>{
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" })
    }

    const id_user = req.query.id_user;

    const connection = await getConnection();
    const data = await connection.query("SELECT * FROM users WHERE user_id = ?", [id_user]);
    const projects = await connection.query("SELECT * FROM projects WHERE user_id = ?", [id_user]);
    const templates = await connection.query("SELECT * FROM templates");

    if(!data.length > 0 && !projects.length > 0 && !templates.length > 0){
        return res.status(400).send({ status: "Bad Request", message: "El Usuario no existe." })
    }

    data[0].password = undefined;

    const info_user = {
        users: data[0],
        projects: projects,
        templates: templates
    }

    res.status(200).send({ status: "Good Request", message: info_user })
});

//Obtenere todos los proyectos de un usuario
app.get("/user/projects", async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" })
    }

    const id_user = req.query.id_user;

    const connection = await getConnection();
    const data = await connection.query("SELECT * FROM projects WHERE user_id = ?", [id_user]);

    if(!data.length > 0){
        return res.status(400).send({ status: "Bad Request", message: "El Usuario no tiene proyectos." })
    }

    res.status(200).send({ status: "Good Request", message: data })
});

//Obtener los colaboradores de un proyecto
app.get("/project/collaborators", async (req, res) => {
    const project_id = req.query.id_project;

    try {
        const connection = await getConnection();
        const collaboratorsProject = await connection.query("SELECT * FROM projects WHERE project_id = ?", [project_id]);

        if (!collaboratorsProject.length) {
            return res.status(404).send({ status: "Not Found", message: "Proyecto no encontrado." });
        }

        let data;
        try {
            data = JSON.parse(collaboratorsProject[0].collaborators);
        } catch (error) {
            return res.status(500).send({ status: "Internal Server Error", message: "Error al procesar los datos de colaboradores." });
        }

        res.status(200).send({ state: true, collaborators: data });

    } catch (error) {
        console.error(error);
        res.status(500).send({ status: "Internal Server Error", message: "Error al conectar con la base de datos." });
    }
});

//Obtener un solo proyecto por su id
app.get("/user/project", async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" })
    }

    const id_project = req.query.id_project;

    const connection = await getConnection();
    const data = await connection.query("SELECT * FROM projects WHERE project_id = ?", [id_project]);

    if(!data.length > 0){
        return res.status(400).send({ status: "Bad Request", message: "El Proyecto no existe." })
    }

    res.status(200).send({ status: "Good Request", message: data[0] })
});

app.get("/templates", async (req, res) => {
    const connection = await getConnection();
    const data = await connection.query("SELECT * FROM templates ORDER BY date_create ASC");

    if(!data.length > 0){
        return res.status(400).send({ status: "Bad Request", message: "No hay plantillas." })
    }

    res.status(200).send({ status: "Good Request", message: data })
});

app.get("/template/:id_template", async (req, res) => {
    const id_template = req.params.id_template;

    const connection = await getConnection();
    const data = await connection.query("SELECT * FROM templates WHERE template_id = ?", [id_template]);

    if(!data.length > 0){
        return res.status(400).send({ status: "Bad Request", message: "La plantilla no existe." })
    }

    res.status(200).send({ status: "Good Request", message: data[0] })
})

//search templates
app.get("/templates/search", async (req, res) => {
    const connection = await getConnection();
    const data = await connection.query("SELECT * FROM templates");

    if(!data.length > 0){
        return res.status(400).send({ status: "Bad Request", message: "No hay plantillas." })
    }

    res.status(200).send({ status: "Good Request", message: data })
});

app.get("/preferences/data", async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" })
    }

    const id_user = req.query.id_user;

    const connection = await getConnection();
    const data = await connection.query("SELECT favorites FROM preferences WHERE user_id = ?", [id_user]);
    
    if(!data.length > 0 ){
        return res.status(400).send({ status: "Bad Request", message: "No se encuentran favoritos." })
    }

    res.status(200).send({ status: "Good Request", message: data })
});

//delete favorites
app.delete("/preferences/favorite", async (req, res) => {
    if (!req.body) {
        return res.status(400).send({ status: "Bad Request", message: "Body is empty" });
    }

    const { id, element } = req.body;
    const connection = await getConnection();

    // Consulta para ver si el usuario ya tiene favoritos almacenados
    const userExist = await connection.query("SELECT * FROM preferences WHERE user_id = ?", [id]);

    if (userExist.length > 0) {
        let actualFavorite = userExist[0].favorites ? JSON.parse(userExist[0].favorites) : [];

        // Asegúrate de que `actualFavorite` es un array
        if (!Array.isArray(actualFavorite)) {
            actualFavorite = [];
        }

        // Filtrar el array para eliminar el favorito con el ID correspondiente
        const newFavorites = actualFavorite.filter(fav => fav.id != element);

        if (newFavorites.length === actualFavorite.length) {
            return res.status(404).send({ status: "Not Found", message: "Favorite not found" });
        }

        // Convierte el array actualizado en una cadena JSON
        const updatedFavorites = JSON.stringify(newFavorites);

        // Actualiza la base de datos
        const updateFavorite = await connection.query("UPDATE preferences SET favorites = ? WHERE user_id = ?", [updatedFavorites, id]);

        return res.status(200).send({ status: "Good Request", message: "Favorite removed successfully" });
    } else {
        return res.status(404).send({ status: "Not Found", message: "User has no favorites" });
    }
});

async function generateIdUser(connection) {
    let user_id;
    let isAvailable = false;
    let attempts = 0;
    let min = 9999;
    let max = 999999;
    const maxAttempts = 100;

    while (!isAvailable && attempts < maxAttempts) {
        user_id = Math.floor(Math.random() * max) + min;

        const userIdExists = await connection.query("SELECT user_id FROM users WHERE user_id = ?", [user_id]);
        if (userIdExists.length === 0) {
            isAvailable = true;
        }

        attempts++;
    }

    if (attempts >= maxAttempts) {
        return null;
    }

    return user_id;
}

async function generateIdProject(connection) {
    let project_id;
    let isAvailable = false;
    let attempts = 0;
    let min = 9999;
    let max = 999999;
    const maxAttempts = 100;

    while (!isAvailable && attempts < maxAttempts) {
        project_id = Math.floor(Math.random() * max) + min;

        const userIdExists = await connection.query("SELECT project_id FROM projects WHERE project_id = ?", [project_id]);
        if (userIdExists.length === 0) {
            isAvailable = true;
        }

        attempts++;
    }

    if (attempts >= maxAttempts) {
        return null;
    }

    return project_id;
}

function encrypt(value){
    return CryptoJS.SHA256(value).toString(CryptoJS.enc.Hex);
}

function compareEncrypt(compare, value){
    const compareHash = encrypt(compare);
    return compareHash === value;
}