export async function registerUser(name, mail, pass) {
    const data = {
        username: name,
        email: mail,
        password: pass
    };

    const response = await fetch("http://localhost:4000/register/auth", {
        method: "POST",
        body: JSON.stringify(data),
        headers: {
            "Content-Type": "application/json"
        }
    });

    const responseData = await response.json();

    if (!response.ok) {
        return {state: false, data: responseData.message};
    }

    return {state: true, data: responseData};
}

export async function loginUser(email, password) {
    const data = {
        email: email,
        password: password,
    };

    const response = await fetch(`http://localhost:4000/login/auth`, {
        method: "POST",
        body: JSON.stringify(data),
        headers: {
            "Content-Type": "application/json"
        }
    });

    const responseData = await response.json();

    if (!response.ok) {
        return {state: false, data: responseData.message};
    }

    return {state: true, data: responseData};
}

export async function getDataUser(user_id){
    const response = await fetch(`http://localhost:4000/user/data?id_user=${user_id}`, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
        }
    });

    const responseData = await response.json();

    if (!response.ok) {
        return {state: false, data: responseData.message};
    }

    return {state: true, data: responseData};
}

export async function createProject(id, name, template_id){
    const data = {
        id: Number(id),
        name: name,
        template_id: template_id
    }

    const response = await fetch(`http://localhost:4000/project/create`, {
        method: "POST",
        body: JSON.stringify(data),
        headers: {
            "Content-Type": "application/json"
        }
    });

    const responseData = await response.json();

    if (!response.ok) {
        return {state: false, data: responseData.message};
    }

    return {state: true, data: responseData};
}

export async function saveProject(stageJson, project_id, preview, user_id) {
    const data = {
        stage: stageJson,
        project_id: project_id,
        preview: preview,
        user_id: user_id
    }

    const response = await fetch(`http://localhost:4000/project/save`, {
        method: "POST",
        body: JSON.stringify(data),
        headers: {
            "Content-Type": "application/json",
        }
    });

    const responseData = await response.json();

    if (!response.ok) {
        return {state: false, data: responseData.message};
    }

    return {state: true, data: responseData};
}

export async function saveCollaborators(project_id, collaborators) {
    const data = {
        project_id: project_id,
        collaborators: collaborators
    }

    const response = await fetch(`http://localhost:4000/project/collaborators`, {
        method: "POST",
        body: JSON.stringify(data),
        headers: {
            "Content-Type": "application/json",
        }
    });

    const responseData = await response.json();

    if (!response.ok) {
        return {state: false, data: responseData.message};
    }

    return {state: true, data: responseData};
}

export async function getCollaborators(project_id) {
    const response = await fetch(`http://localhost:4000/project/collaborators/${project_id}`, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
        }
    });

    const responseData = await response.json();

    if (!response.ok) {
        return { state: false, message: responseData.message };
    }

    return { state: true, collaborators: responseData.collaborators };
}

export async function getAllTemplates(){
    const response = await fetch(`http://localhost:4000/templates`, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
        }
    });

    const responseData = await response.json();

    if (!response.ok) {
        return {state: false, data: responseData.message};
    }

    return {state: true, data: responseData};
}

export async function getTemplate(id_template){
    const response = await fetch(`http://localhost:4000/template/${id_template}`, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
        }
    });

    const responseData = await response.json();

    if (!response.ok) {
        return {state: false, data: responseData.message};
    }

    return {state: true, data: responseData};
}

//Funcion para obtener todos los proyectos de un usuario
export async function getAllProjects(user_id) {
    const response = await fetch(`http://localhost:4000/user/projects?id_user=${user_id}`, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
        }
    });

    const responseData = await response.json();

    if (!response.ok) {
        return {state: false, data: responseData.message};
    }

    return {state: true, data: responseData};
}

export async function getProject(id_project){
    const response = await fetch(`http://localhost:4000/user/project?id_project=${id_project}`, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
        }
    });

    const responseData = await response.json();

    if (!response.ok) {
        return {state: false, data: responseData.message};
    }

    return {state: true, data: responseData};
}

//Delete project with method post
export async function deleteProject(id_project){
    const response = await fetch(`http://localhost:4000/project/delete`, {
        method: "POST",
        body: JSON.stringify({id_project: id_project}),
        headers: {
            "Content-Type": "application/json",
        }
    });

    const responseData = await response.json();

    if (!response.ok) {
        return {state: false, data: responseData.message};
    }

    return {state: true, data: responseData};
}

//Delete list project with method post
export async function deleteListProjects(list_projects){
    const response = await fetch(`http://localhost:4000/project/deleteList`, {
        method: "POST",
        body: JSON.stringify({list_projects: list_projects}),
        headers: {
            "Content-Type": "application/json",
        }
    });

    const responseData = await response.json();

    if (!response.ok) {
        return {state: false, data: responseData.message};
    }

    return {state: true, data: responseData};
}

export async function duplicateProject(id_project){
    const response = await fetch(`http://localhost:4000/project/duplicate`, {
        method: "POST",
        body: JSON.stringify({id_project: id_project}),
        headers: {
            "Content-Type": "application/json",
        }
    });

    const responseData = await response.json();

    if (!response.ok) {
        return {state: false, data: responseData.message};
    }

    return {state: true, data: responseData};
}

export async function duplicateListProjects(list_projects){
    const response = await fetch(`http://localhost:4000/project/duplicateList`, {
        method: "POST",
        body: JSON.stringify({list_projects: list_projects}),
        headers: {
            "Content-Type": "application/json",
        }
    });

    const responseData = await response.json();

    if (!response.ok) {
        return {state: false, data: responseData.message};
    }

    return {state: true, data: responseData};
}

// Rename project with method POST
export async function renameProject(id_project, name){
    const data = {
        id_project: id_project,
        name: name
    }

    if(name.length > 20 || name.length <= 0 || name.trim().length === 0){
        return {state: false, data: "Nombre no valido"};
    }

    const response = await fetch(`http://localhost:4000/project/rename`, {
        method: "POST",
        body: JSON.stringify(data),
        headers: {
            "Content-Type": "application/json",
        }
    });
    
    const responseData = await response.json();
    
    if (!response.ok) {
        return {state: false, data: responseData.message};
    }

    return {state: true, data: responseData};
}

//add project in Favorites
export async function favorite(id, element) {
    const { id_project, type } = element;

    const data = {
        id: Number(id),
        id_project: Number(id_project),
        type: type,
    }

    const response = await fetch(`http://localhost:4000/preferences/favorite`, {
        method: "POST",
        body: JSON.stringify(data),
        headers: {
            "Content-Type": "application/json",
        }
    });
    
    const responseData = await response.json();
    
    if (!response.ok) {
        return {state: false, data: responseData.message};
    }

    return {state: true, data: responseData.message};
}

// quit project in favorites
export async function unfavorite(id_user, id_element) {

    const data = {
        id:id_user,
        element:id_element,
    }; 

    const response = await fetch(`http://localhost:4000/preferences/favorite`, {
        method: "DELETE",
        body: JSON.stringify(data),
        headers: {
            "Content-Type": "application/json",
        }
    });
    
    const responseData = await response.json();
    
    if (!response.ok) {
        return {state: false, data: responseData.message};
    }

    return {state: true, data: responseData.message};
}

export async function getFavorites(id_user) {
    const response = await fetch(`http://localhost:4000/preferences/data?id_user=${id_user}`, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
        }
    });
    
    const responseData = await response.json();

    if (!response.ok) {
        return {state: false, data: responseData.message};
    }

    return {state: true, data: responseData};
}

// Obtener email
export async function checkEmail(id_user, email) {

    const data = {
        id: id_user,
        email: email,
    };

    const response = await fetch(`http://localhost:4000/user/checkEmail`, {
        method: "POST",
        body: JSON.stringify(data),
        headers: {
            "Content-Type": "application/json",
        }
    });

    const responseData = await response.json();
    
    if (!response.ok) {
        return {state: false, data: responseData.message};
    }
    
    return {state: true, data: responseData.message};
}

// Actualizar nombre de usuario
export async function updateUsername(id_user, newUsername){
    const newData = {
        id: id_user,
        username: newUsername,
    };

    const response = await fetch(`http://localhost:4000/user/updateUsername`, {
        method: "POST",
        body: JSON.stringify(newData),
        headers: {
            "Content-Type": "application/json",
        }
    });

    const responseData = await response.json();
    
    if (!response.ok) {
        return {state: false, data: responseData.message};
    }

    return {state: true, data: responseData};
}

export async function checkPassword(user, password){
    const data = {
        user: user,
        password: password,
    };

    const response = await fetch(`http://localhost:4000/user/checkPassword`,{
        method: "POST",
        body: JSON.stringify(data),
        headers: {
            "Content-Type": "application/json",
        }
    });

    const responseData = await response.json();
    
    if (!response.ok) {
        return {state: false, data: responseData.message};
    }
    
    return {state: true, data: responseData};
}

export async function updatePassword(user, newPassword) {
    const data = {
        user: user,
        password: newPassword,
    };
    
    const response = await fetch(`http://localhost:4000/user/updatePassword`, {
        method: "POST",
        body: JSON.stringify(data),
        headers: {
            "Content-Type": "application/json",
        }
    });

    const responseData = await response.json();
    
    if (!response.ok) {
        return {state: false, data: responseData.message};
    }
    
    return {state: true, data: responseData};
}

export async function updateBiography(user, newBio){
    const data = {
        id: user,
        biography: newBio,
    };
    
    const response = await fetch(`http://localhost:4000/user/updateBiography`, {
        method: "POST",
        body: JSON.stringify(data),
        headers: {
            "Content-Type": "application/json",
        }
    });

    const responseData = await response.json();
    
    if (!response.ok) {
        return {state: false, data: responseData.message};
    }
    
    return {state: true, data: responseData};
}

export async function updateProfile(data){
    const response = await fetch(`http://localhost:4000/user/updateProfile`, {
        method: "POST",
        body: JSON.stringify(data),
        headers: {
            "Content-Type": "application/json",
        }
    });

    const responseData = await response.json();
    
    if (!response.ok) {
        return {state: false, data: responseData.message};
    }
    
    return {state: true, data: responseData};
}

export async function likeTemplate(template_id, id_user){
    const data = {
        id_user: id_user,
        template_id: template_id
    }

    const response = await fetch(`http://localhost:4000/template/like`, {
        method: "POST",
        body: JSON.stringify(data),
        headers: {
            "Content-Type": "application/json",
        }
    });

    const responseData = await response.json();
    
    if (!response.ok) {
        return {state: false, data: responseData.message};
    }
    
    return {state: true, data: responseData};
}

export async function dislikeTemplate(template_id, id_user){
    const data = {
        id_user: id_user,
        template_id: template_id
    }

    const response = await fetch(`http://localhost:4000/template/dislike`, {
        method: "POST",
        body: JSON.stringify(data),
        headers: {
            "Content-Type": "application/json",
        }
    });

    const responseData = await response.json();
    
    if (!response.ok) {
        return {state: false, data: responseData.message};
    }
    
    return {state: true, data: responseData};
}