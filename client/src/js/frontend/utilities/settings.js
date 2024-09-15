import * as globals from '../utilities/globals'
import * as req from "../../backend/requests";
import * as templates from '../utilities/templates'    
import * as front from '../front';
import Toastify from 'toastify-js'

// Importar funciones y elementos de utilidad
const utils = front.utils;
const elements = front.elements;

//Seleccionar theme (diseño)
const configs = {
    theme: localStorage.getItem('selectedTheme') || "",
    font: localStorage.getItem('selectedFont') || "",
};

// ------------------------- Show settings content -------------------------------
// Options buttons
const profileOption = document.querySelector('#profile-option')
const securityOption = document.querySelector('#security-option')

//Content buttons
const profileContent = document.querySelector('#profile-content')
const securityContent = document.querySelector('#security-content')

profileOption?.addEventListener("click", () => {
    profileContent.style.display = "flex";
    securityContent.style.display = "none";
});

securityOption?.addEventListener("click", () => {
  profileContent.style.display = "none";
    securityContent.style.display = "flex";  
});

//Close settings
const closeButton = document.querySelector('#close_configurations');
closeButton?.addEventListener("click", () => {
  document.querySelector('#content-configurations').style.display = "none";
  document.documentElement.style.overflow = "";
});

//Open settings
const openButton = document.querySelector('#openSettings');
openButton?.addEventListener("click", () => {
  document.querySelector('#content-configurations').style.display = "flex";
  document.documentElement.style.overflow = "hidden";
});

// Apply profile picture and store in database
async function updateProfileImage() {
    const userId = globals.getCookie("ID-USER");
    const validation = await req.getProfileImage(userId);

    if (validation.profileImage) {
      elements.imageContainer.forEach(item => {
        item.style.backgroundImage = `url(${validation.profileImage})`;
        item.style.backgroundSize = 'cover';
        item.style.backgroundPosition = 'center';
        item.style.border = `2px solid #1E90FF`;
        item.style.opacity = '0.7';
      });
    } else {
      elements.imageContainer.forEach(item => {
        item.style.backgroundImage = `url(https://cdn.icon-icons.com/icons2/1378/PNG/512/avatardefault_92824.png)`;
        item.style.backgroundSize = 'cover';
        item.style.backgroundPosition = 'center';
        item.style.border = `2px solid #1E90FF`;
      });
    }
}

document?.addEventListener('DOMContentLoaded', () => {
    updateProfileImage();
});

elements.imageUpload?.addEventListener('change', async (event) => {
    const target = event.target;
    const file = target.files?.[0];

    if (file) {
      const reader = new FileReader();
      reader.onload = async (e) => {
            if (e.target && e.target.result) {
                const imageBase64 = e.target.result;
                
                const data = {
                    userId: globals.getCookie("ID-USER"),
                    profileImage: imageBase64,
                };

                const validation = await req.updateImageProfile(data);
                elements.imageContainer.forEach(item =>{
                    item.style.backgroundImage = `url(${e.target.result})`;
                    item.style.backgroundSize = 'cover';
                    item.style.backgroundPosition = 'center'; 
                    item.style.border = `2px solid #1E90FF`;
                });

                if(!validation.state){
                    console.log("Error updating image profile ")
                    return;
                }
            }
        };
      reader.readAsDataURL(file);
    }
});

// Edit username
document.querySelector('#edit-icon-username')?.addEventListener("click", () => {
  const usernameInput = document.querySelector("#profile-username");
  const editIcon = document.querySelector("#edit-icon-username");
  const optionsButtons = document.querySelector("#options-buttons-profile");

  usernameInput.removeAttribute("readonly");
  usernameInput.style.opacity = 1;
  usernameInput.focus();

  optionsButtons.style.display = "flex";
  editIcon.style.pointerEvents = "none";
  editIcon.style.opacity = '0.5';

  // Track modification
  usernameInput.dataset.modified = "true"; 
});

// Edit email
document.querySelector('#edit-icon-email')?.addEventListener("click", () => {
  const emailInput = document.querySelector('#profile-email');
  const contentEditEmail = document.querySelector('#div-edit-email');
  const editIcon = document.querySelector('#edit-icon-email');
  const optionsButtons = document.querySelector('#options-buttons-profile');

  if(document.querySelectorAll(".containerEditEmail").length === 0){
    for(let i = 0; i < 2; i++){
      const containerEmailInput = document.createElement("div");
      containerEmailInput.className = "w-full flex items-center containerEditEmail";
      contentEditEmail.appendChild(containerEmailInput);

      const inputEmail = templates.getCloneInputEmail(containerEmailInput);
      inputEmail.focus();
    }

    optionsButtons.style.display = "flex";
    editIcon.style.pointerEvents = "none";
    editIcon.style.opacity = 0.5;
  }

  // Track modification
  emailInput.dataset.modified = "true"; 
});

// Edit biography
document.querySelector('#textarea-biography')?.addEventListener("click", () =>{
    // Track modification
  const textareaBiography = document.querySelector('#textarea-biography');
    document.querySelector("#textarea-biography")?.addEventListener("input", () => {
      const optionsButtons = document.querySelector('#options-buttons-profile');
      optionsButtons.style.display = "flex";
      textareaBiography.dataset.modified = "true";
    })
});

// Save Changes for Modified Inputs
document.querySelector('#button-save-changes')?.addEventListener("click", async () => {
  const userId = globals.getCookie("ID-USER");
  
  // Prepare data object for modified fields only
  let data = { id: userId };

  // Get values from inputs and check if modified
  const usernameInput = document.querySelector("#profile-username");
  const emailInputs = document.querySelectorAll(".containerEditEmail input");
  const biographyTextarea = document.querySelector("#textarea-biography");

  if (usernameInput.dataset.modified === "true" && usernameInput.value.trim()) {
    data.username = usernameInput.value.trim();
  } else if(!(usernameInput.value.trim())){
    utils.handleError("Please enter new username");
    return;
  }

  if (emailInputs.length > 0 && emailInputs[0].value.trim()) {
    const newEmail1 = emailInputs[0]?.value;
    const newEmail2 = emailInputs[1]?.value;

    if(newEmail1 !== newEmail2){
      utils.handleError("The emails are not the same");
      return;
    }

    if(!utils.validateEmail(emailInputs[0].value) || !utils.validateEmail(emailInputs[1].value)){
        utils.handleError("Please enter a valid new email address");
        return;
    }

    data.email = newEmail1.trim();
    }   
    
    if (emailInputs.length > 0 && !(emailInputs[0].value.trim()) || emailInputs.length > 0 && !(emailInputs[1].value.trim())){
        utils.handleError("Please enter both email addresses");
        return;
    } 

  
    if (biographyTextarea.dataset.modified === "true" && biographyTextarea.value.trim()) {
    data.biography = biographyTextarea.value.trim();
  }

  // Send modified data to the backend
  const validation = await req.updateProfile(data);

  if(!validation.state){
    utils.handleError(validation);
    return;
  }

  // Reset fields and UI
  if (usernameInput.dataset.modified === "true") {
    usernameInput.setAttribute("readonly", "");
    usernameInput.style.opacity = 0.5;
    delete usernameInput.dataset.modified;
  }

  if (emailInputs.length > 0) {
    emailInputs.forEach(input => {
      input.setAttribute("readonly", "");
      input.style.opacity = 0.5;
    });
  }

  if (biographyTextarea.dataset.modified === "true") {
    biographyTextarea.setAttribute("readonly", "");
    biographyTextarea.style.opacity = 0.5;
    delete biographyTextarea.dataset.modified;
  }

  // Hide save button
  document.querySelector('#options-buttons-profile').style.display = 'none';

  // Reload page to reflect changes
  window.location.reload();
});

// Cancel Changes for Modified Inputs
document.querySelector('#button-cancel-changes')?.addEventListener("click", () => {
  const textareaBiography = document.querySelector('#textarea-biography');
  const usernameInput = document.querySelector("#profile-username");
  const emailInputs = document.querySelectorAll(".containerEditEmail input");
  const optionsButtons = document.querySelector('#options-buttons-profile');

  if (usernameInput.dataset.modified === "true") {
    const editIcon = document.querySelector("#edit-icon-username");
    const usernameValue = usernameInput.value;
    
    usernameInput.setAttribute("readonly", "");
    usernameInput.style.opacity = 0.5;
    usernameInput.value = usernameValue;
    delete usernameInput.dataset.modified;

    document.querySelectorAll(".error-message").forEach(el => el.remove());
    optionsButtons.style.display = "none";
    editIcon.style.pointerEvents = "auto";
    editIcon.style.opacity = 1;
  }

  if (emailInputs.length > 0) {
    const emailInput = document.querySelector('#profile-email');
    const editIcon = document.querySelector('#edit-icon-email');
    const currentEmails = document.querySelectorAll(".containerEditEmail");
    currentEmails.forEach(container => container.remove());

    optionsButtons.style.display = "none";
    emailInput.removeAttribute("readonly");
    emailInput.style.opacity = 0.5;

    document.querySelectorAll(".error-message").forEach(el => el.remove());
    editIcon.style.pointerEvents = "auto";
    editIcon.style.opacity = 1;
  }

  if (textareaBiography.dataset.modified === "true") {
    const BiographyValue = textareaBiography.value;

    textareaBiography.value = BiographyValue;
    delete textareaBiography.dataset.modified;
    document.querySelectorAll(".error-message").forEach(el => el.remove());
    optionsButtons.style.display = "none";
  }
})

//iniciar el modo de edición de contraseña
document.querySelector('#edit-icon-password')?.addEventListener('click', async () => {
  const editIcon = document.querySelector('#edit-icon-password');
  const passwordInput = document.querySelector('#password');

  // Preparar el campo de contraseña para edición
  passwordInput.removeAttribute("readonly");
  passwordInput.style.opacity = 1;
  passwordInput.value = "";
  passwordInput.focus();

  editIcon.style.pointerEvents = 'none';
  editIcon.style.opacity = '0.5';

  // Función para comparar la contraseña actual
  const comparePassword = async () => {
    const optionsButtons = document.querySelector('#options-buttons-password');
    const inputsEdits = document.querySelector('#edit-password');
    const inputNewPassword = document.querySelector('#newPassword');

    const userId = globals.getCookie("ID-USER");
    const currentPassword = passwordInput.value;
    
    const validation = await req.checkPassword(userId, currentPassword);

    // Limpiar mensajes de error previos
    document.querySelectorAll(".error-message").forEach(el => el.remove());
    passwordInput.classList.remove("border-red-500");

    if (validation.state) {
      inputsEdits.style.display = "flex";
      passwordInput.setAttribute("readonly", true);
      optionsButtons.style.display = "flex";
      inputNewPassword.focus();
    } else {
      passwordInput.classList.add("border-red-500");
      passwordInput.classList.add("border");

      const errorMessage = document.createElement("p");
      errorMessage.className = "error-message w-fit text-red-500 text-sm mt-2";
      errorMessage.textContent = "The password is incorrect.";
      passwordInput.parentNode.insertBefore(errorMessage, passwordInput.nextSibling);

      utils.handleError(validation);    
    }
  };

  // Manejo del botón de guardar cambios
  const saveChangesButton = document.querySelector("#button-save-security");
  saveChangesButton?.addEventListener('click', async () => {
    const newPassword = document.querySelector('#newPassword').value;
    const confirmNewPassword = document.querySelector('#confirmNewPassword').value;
    const userId = globals.getCookie('ID-USER');

    document.querySelectorAll(".error-message").forEach(el => el.remove());
    document.querySelectorAll("#newPassword, #confirmNewPassword").forEach(input => {
      input.classList.remove("border-red-500");
    });

    if (newPassword === confirmNewPassword) {
      const updatePassword = await req.updatePassword(userId, newPassword);
      
      if (updatePassword.state) {
        window.location.reload();
      } else {
        utils.handleError("Error al actualizar la contraseña.");
      }
    } else {
      document.querySelectorAll("#newPassword, #confirmNewPassword").forEach(input => {
        input.classList.add("border-red-500");
        input.classList.add("border");
      });

      const errorMessage = document.createElement("p");
      errorMessage.className = "error-message w-full text-red-500 text-sm mt-2";
      errorMessage.textContent = "Passwords do not match";
      document.querySelector('#confirmNewPassword').parentNode.insertBefore(errorMessage, document.querySelector('#confirmNewPassword').nextSibling);

      utils.handleError("Las contraseñas no coinciden.");
    }
  });

  // Permitir enviar al presionar Enter
  passwordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      comparePassword();
    }
  });

  // Cancel changes
  const cancelButton = document.querySelector("#button-cancel-security");
    
cancelButton?.addEventListener("click", () => {
    const editIcon = document.querySelector("#edit-icon-password");
    const passwordInput = document.querySelector("#password");
    const inputsEdits = document.querySelector('#edit-password');
    const optionsButtons = document.querySelector('#options-buttons-password');
    const newPasswordInput = document.querySelector('#newPassword');
    const confirmNewPasswordInput = document.querySelector('#confirmNewPassword');

    passwordInput.setAttribute("readonly", true);
    passwordInput.style.opacity = 0.5;
    passwordInput.value = "";

    inputsEdits.style.display = "none";

    optionsButtons.style.display = "none";

    editIcon.style.pointerEvents = "auto";
    editIcon.style.opacity = 1;

    newPasswordInput.value = "";
    confirmNewPasswordInput.value = "";

    document.querySelectorAll(".error-message").forEach(el => el.remove());
    document.querySelectorAll("#newPassword, #confirmNewPassword, #password").forEach(input => {
      input.classList.remove("border-red-500");
      input.classList.remove("border");
    });
  });
});

document?.addEventListener('DOMContentLoaded', () => {
    if (configs.theme) {
      applyTheme(configs.theme);
    }
  
    elements.themeOptions.forEach(option => {
      option?.addEventListener('click', () => {
        elements.themeOptions.forEach(item => item.classList.remove('border-4', 'border-blue-500', 'shadow-lg'));
        configs.theme = option.getAttribute("data-theme");
        localStorage.setItem('selectedTheme', configs.theme);
        option.classList.add('border-4', 'border-blue-500', 'shadow-lg');
      });
    });
  
    // Función para aplicar el tema almacenado
    function applyTheme(theme) {
      const selectedOption = document.querySelector(`[data-theme="${theme}"]`);
      if (selectedOption) {
        selectedOption.classList.add('border-4', 'border-blue-500', 'shadow-lg');
      }
    }
});