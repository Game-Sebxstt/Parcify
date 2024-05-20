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

export async function saveProject(stageJson, project_id, preview) {
    const data = {
        stage: stageJson,
        project_id: project_id,
        preview: preview
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