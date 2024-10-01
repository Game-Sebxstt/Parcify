import * as req from '../backend/requests'

//UTILS
const utils = {
    validateEmail: (email) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    },
    setCookie: (name, value, days) => {
        let expires = "";
        if (days) {
        const date = new Date();
        date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
        expires = "; expires=" + date.toUTCString();
        }
        document.cookie = name + "=" + (value || "") + expires + "; path=/";
    }
}

//CONST ELEMENTS
const elements = {
    formLogin: document.getElementById("form_login"),
    formRegister: document.getElementById("form_signUp"),
    authCodeContainer: document.querySelector("#authCodeContainer"),
    authCodeClose: document.querySelector("#close-authCode"),
    authCodeVerificate: document.querySelector("#authCodeVerificate"),
    resendCodeAuth: document.querySelector("#resendCodeAuth")
}

elements.formLogin?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("email_login").value;
  const password = document.getElementById("password_login").value;

  const validation = await req.loginUser(email, password);

  if (!validation.state || !validation) {
    console.error("Invalid login");
    return;
  }

  utils.setCookie("ID-USER", validation.data.message, 1);
  utils.setCookie("logged", true, 1);
  window.location.href = "/";
});
    
elements.formRegister?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("name_register").value;
  const email = document.getElementById("email_register").value;
  const password = document.getElementById("password_register").value;
  const displayAuth = window.getComputedStyle(elements.authCodeContainer).display;

  if (username.length > 3 && utils.validateEmail(email)) {
    const dataRegister = await req.registerUser(username, email, password);

    if (!dataRegister.state) {
      utils.handleError(dataRegister);
      return;
    }

    elements.authCodeContainer.style.display = displayAuth == "none" ? "flex" : "none";      
    // window.location.href = "/SignIn";
  }
});

elements.authCodeVerificate?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorCode = document.getElementById("errorCodeAuth")
  const email = document.getElementById("email_register").value;
  const inputs = document.querySelectorAll("#inputCode");
  const errorDisplay = window.getComputedStyle(errorCode).display;
  let code = [];

  inputs.forEach(input => {
    code.push(Number(input.value))
  })
  
  const auth = await req.verificateCode(email, code.join(""));

  if (!auth.state) {
    utils.handleError(auth);
    inputs.forEach(input => {
      input.style.outline = "2px solid #f87171"
    })
    errorCode.style.display = errorDisplay == "none" ? "flex" : "none";
    return;
  }

  window.location.href = "/SignIn";
})

// close code Authentication
elements.authCodeClose?.addEventListener("click", async ()=>{
  const email = document.getElementById("email_register").value;

  const cancelAuth = await req.cancelVerificateCode(email);

  if (!cancelAuth.state) {
    utils.handleError(cancelAuth);
    return;
  }

  const display = window.getComputedStyle(elements.authCodeContainer).display;
  elements.authCodeContainer.style.display = display == "flex" ? "none" : "flex"
})

elements.resendCodeAuth?.addEventListener("click", async () => {
  const email = document.getElementById("email_register").value;
  const resendAuthSuccess = document.getElementById("resendAuthSuccess");
  const displayResend = window.getComputedStyle(resendAuthSuccess).display;

  const resendCode = await req.resendAuthCode(email);
  
  if (!resendCode.state) {
    utils.handleError(resendCode);
    return;
  }

  resendAuthSuccess.style.display = displayResend == "none" ? "flex" : "none";
  setTimeout(() => {
    resendAuthSuccess.style.display = "none";
  }, 3000);
});