async function registerUser(name, mail, pass) {
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

async function loginUser(email, password) {
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

export default {
    registerUser,
    loginUser,
};