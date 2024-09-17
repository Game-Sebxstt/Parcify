import * as environments from '../../../../config'

export async function registerUser(name, mail, pass) {
    const data = {
        username: name,
        email: mail,
        password: pass
    };

    const response = await fetch(`${environments.DEFAULT_API_URL}/auth/register`, {
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

    const response = await fetch(`${environments.DEFAULT_API_URL}/auth/login`, {
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
    const response = await fetch(`${environments.DEFAULT_API_URL}/user/data?id_user=${user_id}`, {
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

    const response = await fetch(`${environments.DEFAULT_API_URL}/project/create`, {
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

    const response = await fetch(`${environments.DEFAULT_API_URL}/project/save`, {
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

    const response = await fetch(`${environments.DEFAULT_API_URL}/project/collaborators`, {
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

export async function getCollaborators(id_project) {
    const response = await fetch(`${environments.DEFAULT_API_URL}/project/collaborators?id_project=${id_project}`, {
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
    const response = await fetch(`${environments.DEFAULT_API_URL}/template/templates`, {
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
    const response = await fetch(`${environments.DEFAULT_API_URL}/template/${id_template}`, {
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
    const response = await fetch(`${environments.DEFAULT_API_URL}/user/projects?id_user=${user_id}`, {
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
    if(!id_project){
        return {state: false, data: "El id del proyecto no es valido"};
    }

    const response = await fetch(`${environments.DEFAULT_API_URL}/user/project?id_project=${id_project}`, {
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
    const response = await fetch(`${environments.DEFAULT_API_URL}/project/delete`, {
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
    const response = await fetch(`${environments.DEFAULT_API_URL}/project/deleteList`, {
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
    const response = await fetch(`${environments.DEFAULT_API_URL}/project/duplicate`, {
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
    const response = await fetch(`${environments.DEFAULT_API_URL}/project/duplicateList`, {
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

    const response = await fetch(`${environments.DEFAULT_API_URL}/project/rename`, {
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

    const response = await fetch(`${environments.DEFAULT_API_URL}/preferences/favorite`, {
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

    const response = await fetch(`${environments.DEFAULT_API_URL}/preferences/favorite`, {
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
    const response = await fetch(`${environments.DEFAULT_API_URL}/preferences/data?id_user=${id_user}`, {
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

export async function checkPassword(user, password){
    const data = {
        user: user,
        password: password,
    };

    const response = await fetch(`${environments.DEFAULT_API_URL}/user/checkPassword`,{
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
    
    const response = await fetch(`${environments.DEFAULT_API_URL}/user/updatePassword`, {
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
    const response = await fetch(`${environments.DEFAULT_API_URL}/user/updateProfile`, {
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

export async function updateImageProfile(data){
    const response = await fetch(`${environments.DEFAULT_API_URL}/user/updateImageProfile`, {
        method: "POST",
        body: JSON.stringify(data),
        headers:{
            "Content-Type": "application/json",
        }
    });

    const responseData = await response.json();

    if(!response.ok){
        return {state: false, data: responseData.message};
    }
    
    return {state: true, data: responseData};
}

export async function getProfileImage(userId) {
  const response = await fetch(`${environments.DEFAULT_API_URL}/user/getProfileImage`, {
    method: "POST",
    body: JSON.stringify({userId}),
    headers: {
      "Content-Type": "application/json",
    },
  });

  const responseData = await response.json();

  if (!response.ok) {
    return { state: false, data: responseData.message };
  }

  return { state: true, profileImage: responseData.profileImage };
}

export async function likeTemplate(template_id, id_user){
    const data = {
        id_user: id_user,
        template_id: template_id
    }

    const response = await fetch(`${environments.DEFAULT_API_URL}/template/like`, {
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

    const response = await fetch(`${environments.DEFAULT_API_URL}/template/dislike`, {
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

export async function sendMessageChat(data, id_project){
    const response = await fetch(`${environments.DEFAULT_API_URL}/chat/send`, {
        method: "POST",
        body: JSON.stringify({data: data, id_project: id_project}),
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

export async function sendInvitationProject(id_project, props){
    const response = await fetch(`${environments.DEFAULT_API_URL}/user/invitation/send`, {
        method: "POST",
        body: JSON.stringify({invitation: props.invitation, role: props.role, id_project: id_project}),
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

// email verification
export async function verificateCode(email, code) {
    const data = {
        email:email,
        code:code,
    }

    const response = await fetch(`${environments.DEFAULT_API_URL}/auth/codeVerification`, {
        method: "POST",
        body: JSON.stringify(data),
        headers:{
            "Content-Type": "application/json",
        }
    });

    const responseData = await response.json();

    if (!response.ok) {
        return {state: false, data: responseData.message};
    }

    return {state: true, data: responseData};

}

// cancel emailVerification
export async function cancelVerificateCode(email) {
    const data = {
        email:email,
    }

    const response = await fetch(`${environments.DEFAULT_API_URL}/auth/register/cancel`, {
        method: "POST",
        body: JSON.stringify(data),
        headers:{
            "Content-Type": "application/json",
        }
    });

    const responseData = await response.json();

    if (!response.ok) {
        return {state: false, data: responseData.message};
    }

    return {state: true, data: responseData};

}

// 
export async function resendAuthCode(email) {
    const data = {
        email:email,
    }

    const response = await fetch(`${environments.DEFAULT_API_URL}/auth/resendAuthCode`, {
        method: "POST",
        body: JSON.stringify(data),
        headers:{
            "Content-Type": "application/json",
        }
    });

    const responseData = await response.json();

    if (!response.ok) {
        return {state: false, data: responseData.message};
    }

    return {state: true, data: responseData};

}

// 2FA send data
export async function twoFastAuth(data) {
    const response = await fetch(`${environments.DEFAULT_API_URL}/auth/device`, {
        method: "POST",
        body: JSON.stringify(data),
        headers:{
            "Content-Type": "application/json",
        }
    });

    const responseData = await response.json();

    if (!response.ok) {
        return {state: false, data: responseData.message};
    }

    return {state: true, data: responseData};
}

twoFastAuth({
    id_user:1234,
    device:"android_10",
    country:"pakistan",
    date:"91280491",
    type:"mobile",
});