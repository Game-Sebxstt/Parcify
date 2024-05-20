import * as req from './backend/requests';

//Options

const filter_index = document.querySelectorAll('#filter');

filter_index?.forEach((element, index) => {
    element?.addEventListener("click", () => {
        const more_options_filter = document.querySelectorAll('#more-options-filter')[index];
        const arrow_down_filter = document.querySelectorAll('#arrow-down-filter')[index];
        if (window.getComputedStyle(more_options_filter).display === 'none') {
            more_options_filter.style.display = 'flex';
            arrow_down_filter.style.transform = 'rotate(180deg)';
        } else {
            more_options_filter.style.display = 'none';
            arrow_down_filter.style.transform = 'rotate(0deg)';
        }
    })
})

const profile = document.querySelector("#profile");

profile?.addEventListener("click", () => {
    const more_options_profile = document.querySelector("#more-options-profile");
    more_options_profile.style.display = window.getComputedStyle(more_options_profile).display == "none" ? 'flex' : 'none';
});

const items_slide = document.querySelectorAll("#items-slide");

items_slide.forEach((element) => {
    element.addEventListener("click", () => {
        window.location.href = element.getAttribute("data-uri");
    });
})

const menu_header = document.querySelector("#menu-header");

menu_header?.addEventListener("click", () => {
    const slide = document.querySelector("#slideMobile");
    if (window.getComputedStyle(slide).left == "0px") {
        slide.style.left = "-100%"
    } else {
        slide.style.left = "0%"
    }
});

const logo_header_slide = document.querySelector("#logo-header-slide");

logo_header_slide?.addEventListener("click", () => {
    window.location.href = logo_header_slide.getAttribute("data-action");
});

const bg_close_invite = document.querySelector("#bg-close-invite");

bg_close_invite?.addEventListener("click", () => {
    document.querySelector("#popup-invite").style.display = "none";
    if (window.getComputedStyle(document.getElementById('users-invited')).display == "flex") {
        document.getElementById('users-invited').style.display = 'none'
        document.getElementById('projectContent').style.display = 'flex'
    }
})

const x_close_invite = document.querySelectorAll("#x-close-invite");

x_close_invite?.forEach((element, i) => {
    element.addEventListener("click", () => {
        document.querySelector("#popup-invite").style.display = "none";
        if (i != 0) {
            document.getElementById('users-invited').style.display = 'none'
            document.getElementById('projectContent').style.display = 'flex'
        }
    })
})

const invite_btn = document.querySelectorAll("#invite-btn");

invite_btn?.forEach((element) => {
    element.addEventListener("click", () => {
        document.querySelector("#popup-invite").style.display = "flex";
    })
});

let menu_btn_list = document.querySelectorAll("#menu-btn");

menu_btn_list.forEach((element) => {
    element.addEventListener("click", () => {
        let attrElement = element.getAttribute("data-section");
        element.style.backgroundColor = "#FC7F53";
        element.style.borderColor = "#ad4b1e";

        menu_btn_list.forEach((item) => {
            if (item != element) {
                item.style.backgroundColor = "#595959";
                item.style.borderColor = "transparent";
            }
        });
    });
});

let close_right_slide = document.querySelector("#close-right-slide");

close_right_slide?.addEventListener("click", () => {
    document.querySelector("#right-slide").style.right = window.getComputedStyle(document.querySelector("#right-slide")).right == "0px" ? "-25rem" : "0px";
});

let close_left_slide = document.querySelector("#close-left-slide");

close_left_slide?.addEventListener("click", () => {
    document.querySelector("#left-slide").style.left = window.getComputedStyle(document.querySelector("#left-slide")).left == "0px" ? "-25rem" : "0px";
});
let menu_btn = document.querySelectorAll("#menu-btn");

menu_btn.forEach(element => {
    element.addEventListener("click", () => {
        let attr = element.getAttribute("data-section");
        let sections_options = document.querySelectorAll(".section_option");

        sections_options.forEach(element => {
            if (element.id == attr) {
                element.style.display = "flex";

                if (attr == "section_folders") {
                    document.querySelector("#header-one").style.display = "none";
                    document.querySelector("#header-two").style.display = "flex";
                } else {
                    document.querySelector("#header-one").style.display = "flex";
                    document.querySelector("#header-two").style.display = "none";
                }

            } else {
                element.style.display = "none";
            }
        })
    });
});

let options_parcel = document.querySelectorAll("#btn-options-parcel");

options_parcel?.forEach(item => {
    item.addEventListener("click", function () {
        item.parentNode.querySelector("#options-parcel").style.display = window?.getComputedStyle(item.parentNode.querySelector("#options-parcel")).display == "none" ? "flex" : "none";
    });
})

let element_project = document.querySelectorAll("#element-project");

element_project?.forEach(item => {
    item.addEventListener("click", function () {
        let attr = item.getAttribute("data-id");

        window.location.hreft = ""

        console.log(attr)
    });
});

//? login

let formLogin = document.getElementById('form_login');
let formRegister = document.getElementById('form_signUp');

formRegister?.addEventListener('submit', async (e) => {
    e.preventDefault();
    let username = document.getElementById('name_register');
    let email = document.getElementById('email_register');
    let password = document.getElementById('password_register');

    if (username.value.length > 3 && validateEmail(email.value)) {
        const data_register = await req.registerUser(username.value, email.value, password.value);

        if (!data_register.state) {
            let errorMensaje = document.getElementById('danger');
            errorMensaje.style.display = "flex"
            errorMensaje.querySelector("#txt").textContent = data_register.data;
            return;
        }

        window.location.href = "/SignIn"
    }
});

formLogin?.addEventListener('submit', async (e) => {
    e.preventDefault()
    let email = document.getElementById('email_login');
    let password = document.getElementById('password_login');

    const validation = await req.loginUser(email.value, password.value);

    if (!validation.state || !validation) {
        let errorMensaje = document.getElementById('danger');
        errorMensaje.style.display = "flex"
        errorMensaje.querySelector("#txt").textContent = validation.data;
        return;
    }

    setCookie("ID-USER", validation.data.message)
    setCookie("logged", true)
    window.location.href = "/"
});


let logout = document.querySelector('#logout');
logout?.addEventListener('click', (e) => {
    e.preventDefault();
    setCookie('ID-USER', "", "0")
    setCookie('logged', "", "0")
    if (getCookie("ID-USER") != null || getCookie("logged") != null) {
        return;
    }
    window.location.reload();
});

//settings
let openSetting = document.querySelector("#openSettings");
openSetting?.addEventListener("click", ()=>{
    let settings = document.querySelector("#settings");
    if (window.getComputedStyle(settings).display == 'none') {
        settings.style.display = 'flex'
    } else {
        settings.style.display = 'none'
    }
})

function validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

function validatePassword(password) {
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    return passwordRegex.test(password);
}

function setCookie(name, value, days) {
    let expires = "";
    if (days) {
        const date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        expires = "; expires=" + date.toUTCString();
    }
    document.cookie = name + "=" + (value || "") + expires + "; path=/";
}

function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) == ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
}

//CREAR PARCELADOR
const createTemplate = document.querySelectorAll("#create-template");

createTemplate?.forEach(item => {
    item.addEventListener("click", async () => {

        const validation = await req.createProject(getCookie("ID-USER"), "Untitled");

        console.log(validation)

        if (!validation.state || !validation) {
            let errorMensaje = document.getElementById('danger');
            errorMensaje.style.display = "flex"
            errorMensaje.querySelector("#txt").textContent = validation.data;
            return;
        }

        // window.location.href="/konva"
    })
});