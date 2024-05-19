async function registerUser(name, mail, pass) {
    //obtenemos los datos del usuario
    const data = {
        username: name,
        email: mail,
        password: pass
    };

    //TODO aqui va 
    //hacemos la peticion y enviamos los dats al en poin
    const response = await fetch("http://localhost:4000/register/auth", {
        method: "POST", // Assuming you're sending a POST request
        body: JSON.stringify(data),
        headers: {
            "Content-Type": "application/json"
        }
    });

    //TODO aqui se regresa
    //recibimos la respuest
    const responseData = await response.json();
    console.log(responseData)

}

//metodo que busque el email ingresado y loguee luego que el endpoint me reenvie el id y guardarñp

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