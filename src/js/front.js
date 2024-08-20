import * as req from "./backend/requests";

// document.addEventListener("contextmenu", function(e){
//     e.preventDefault();
//   }, false);

//Options

const filter_index = document.querySelectorAll("#filter");

filter_index?.forEach((element, index) => {
  element?.addEventListener("click", () => {
    const more_options_filter = document.querySelectorAll(
      "#more-options-filter"
    )[index];
    const arrow_down_filter =
      document.querySelectorAll("#arrow-down-filter")[index];
    if (window.getComputedStyle(more_options_filter).display === "none") {
      more_options_filter.style.display = "flex";
      arrow_down_filter.style.transform = "rotate(180deg)";
    } else {
      more_options_filter.style.display = "none";
      arrow_down_filter.style.transform = "rotate(0deg)";
    }
  });
});

const profile = document.querySelector("#profile");

profile?.addEventListener("click", () => {
  const more_options_profile = document.querySelector("#more-options-profile");
  more_options_profile.style.display =
    window.getComputedStyle(more_options_profile).display == "none"
      ? "flex"
      : "none";
});

const items_slide = document.querySelectorAll("#items-slide");

items_slide.forEach((element) => {
  element.addEventListener("click", () => {
    window.location.href = element.getAttribute("data-uri");
  });
});

const menu_header = document.querySelector("#menu-header");

menu_header?.addEventListener("click", () => {
  const slide = document.querySelector("#slideMobile");
  if (window.getComputedStyle(slide).left == "0px") {
    slide.style.left = "-100%";
  } else {
    slide.style.left = "0%";
  }
});

const logo_header_slide = document.querySelector("#logo-header-slide");

logo_header_slide?.addEventListener("click", () => {
  window.location.href = logo_header_slide.getAttribute("data-action");
});

const bg_close_invite = document.querySelector("#bg-close-invite");

bg_close_invite?.addEventListener("click", () => {
  document.querySelector("#popup-invite").style.display = "none";
  if (
    window.getComputedStyle(document.getElementById("users-invited")).display ==
    "flex"
  ) {
    document.getElementById("users-invited").style.display = "none";
    document.getElementById("projectContent").style.display = "flex";
  }
});

const x_close_invite = document.querySelectorAll("#x-close-invite");

x_close_invite?.forEach((element, i) => {
  element.addEventListener("click", () => {
    document.querySelector("#popup-invite").style.display = "none";
    if (i != 0) {
      document.getElementById("users-invited").style.display = "none";
      document.getElementById("projectContent").style.display = "flex";
    }
  });
});

let projectBox = document.querySelectorAll("#parceler-box");
let projectSelected = document.querySelectorAll(".projectSelected");
let copyLink = document.getElementById("continue");
let usersInvited = document.getElementById("users-invited");
let projectContent = document.getElementById("projectContent");

function setBorder(element, index) {
  element.forEach((e, i) => {
    if (i === index) {
      e.style.border = "2px solid rgb(147 197 253)";
    }
  });
}

function deleteBorder(element, index) {
  element.forEach((e, i) => {
    if (i === index) {
      e.style.border = "2px solid transparent";
    }
  });
}

function verifiCheck(elements, elementChecked) {
  elements.forEach((e, i) => {
    if (e != elementChecked) {
      e.checked = false;
      deleteBorder(projectBox, i);
    } else {
      e.checked = true;
    }
  });
}

if (copyLink) {
  copyLink.disabled = true;
  copyLink.style.opacity = "0.5";
}

projectSelected.forEach((e, i) => {
  e.addEventListener("change", () => {
    console.log(e);
    verifiCheck(projectSelected, e);
    if (e.checked == true) {
      setBorder(projectBox, i);
      copyLink.disabled = false;
      copyLink.style.opacity = "1";
      copyLink.addEventListener("click", () => {
        if (window.getComputedStyle(usersInvited).display == "none") {
          usersInvited.style.display = "flex";
          projectContent.style.display = "none";
        }
      });
    } else {
      deleteBorder(projectBox, i);
      copyLink.disabled = true;
      copyLink.style.opacity = "0.5";
    }
  });
});

const invite_btn = document.querySelectorAll("#invite-btn");

invite_btn?.forEach((element) => {
  element.addEventListener("click", () => {
    document.querySelector("#popup-invite").style.display = "flex";
  });
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
  document.querySelector("#right-slide").style.right =
    window.getComputedStyle(document.querySelector("#right-slide")).right ==
    "0px"
      ? "-25rem"
      : "0px";
});

let close_left_slide = document.querySelector("#close-left-slide");

close_left_slide?.addEventListener("click", () => {
  document.querySelector("#left-slide").style.left =
    window.getComputedStyle(document.querySelector("#left-slide")).left == "0px"
      ? "-25rem"
      : "0px";
});
let menu_btn = document.querySelectorAll("#menu-btn");

menu_btn.forEach((element) => {
  element.addEventListener("click", () => {
    let attr = element.getAttribute("data-section");
    let sections_options = document.querySelectorAll(".section_option");

    sections_options.forEach((element) => {
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
    });
  });
});

let back_index = document.querySelector("#back-index");

back_index?.addEventListener("click", () => {
  window.location.href = "/";
});

let options_parcel = document.querySelectorAll("#element-project");

options_parcel?.forEach((item) => {

  function changeStateWheelWindow(state) {
    if (state) {
        window.addEventListener('wheel', preventScroll, { passive: false });
        window.addEventListener('mousewheel', preventScroll, { passive: false });
    }else{
        window.removeEventListener('wheel', preventScroll);
        window.removeEventListener('mousewheel', preventScroll);
    }
}

// Función que previene el scroll
function preventScroll(event) {
    event.preventDefault();
}

  item.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    changeStateWheelWindow(true);
    item.parentNode.querySelector("#options-parcel").style.display = "flex";
    item.parentNode.querySelector("#options-parcel").style.top =
      e.clientY + "px";
    item.parentNode.querySelector("#options-parcel").style.left =
      e.clientX + "px";

    options_parcel.forEach((element) => {
      if (element != item) {
        element.parentNode.querySelector("#options-parcel").style.display = "none";
      }
    });

    document.addEventListener("click", () => {
      item.parentNode.querySelector("#options-parcel").style.display = "none";
      changeStateWheelWindow(false);
    });
  });
});

//BUSCAR PROYECTOS
let searchBar = document.querySelectorAll("#searchbar");
searchBar.forEach((item) => {
  item?.addEventListener("input", (e) => {
    // Obtener el valor del searchBar y convertirlo a minúsculas
    let searchTerm = item.value.toLowerCase();
    let typeElement = item.getAttribute("data-article");

    console.log(typeElement, searchTerm);
    // Llamar a los proyectos o las platillas
    let elementToFilter = document.querySelectorAll(`#${typeElement}`);

    // Iterar sobre los proyectos para obtener sus atributos
    elementToFilter.forEach((item) => {
      //lo que se tiene que filtrar
      let name = item.getAttribute("data-name")?.toLowerCase();

      if (!name.includes(searchTerm)) {
        item.classList.add("hidden");
      } else {
        item.classList.remove("hidden");
      }
    });
  });
});

//filtrar cosas
let filtros = document.querySelectorAll("#filtro");
filtros.forEach((item, index) => {
  switch (index) {
    case 0:
      item.addEventListener("click", () => {
        let dondeToy = item.parentElement.getAttribute("data-article");
        let elementToFilter = document.querySelectorAll(`#${dondeToy}`);
        //colcar los nombres de los proyectos en un arreglo
        let elementsArray = Array.from(elementToFilter);
        let namesAndElements = elementsArray.map((item) => {
          item.classList.remove("hidden");
          return {
            name: item.getAttribute("data-name"),
            element: item,
          };
        });
        let boxOrdenSelection = document.querySelector("#orden");
        let arrow = boxOrdenSelection.firstChild;

        //de la A a la Z
        let parentElement = elementsArray[0].parentElement;

        if (arrow.id === "arrowDown") {
          //organizacion descendente
          let descendente = namesAndElements.sort((a, b) =>
            b.name.localeCompare(a.name)
          );
          descendente.forEach((item) => {
            parentElement.appendChild(item.element);
          });
        } else {
          //organizacion ascendente
          let ascendente = namesAndElements.sort((a, b) =>
            a.name.localeCompare(b.name)
          );
          ascendente.forEach((item) => {
            parentElement.appendChild(item.element);
          });
        }
      });
      break;
    case 1:
      item.addEventListener("click", () => {
        let mainBox = item.parentElement.getAttribute("data-article");
        let element = document.querySelectorAll(`#${mainBox}`);
        let elementsArray = Array.from(element);
        let datesAndElements = elementsArray.map((el) => {
          item.classList.remove("hidden");
          return {
            date: new Date(el.getAttribute("data-modified")),
            element: el,
          };
        });

        let boxOrdenSelection = item.children[1];
        let arrow = boxOrdenSelection.firstChild;

        // Orden descendente por defecto
        let parentElement = elementsArray[0].parentElement;

        if (arrow.id === "arrowDown") {
          // Organización descendente
          let ascendente = datesAndElements.sort((a, b) => a.date - b.date);
          ascendente.forEach((item) => {
            parentElement.appendChild(item.element);
          });
        } else {
          let descendente = datesAndElements.sort((a, b) => b.date - a.date);
          descendente.forEach((item) => {
            parentElement.appendChild(item.element);
          });
        }
      });
      break;
    case 2:
      item.addEventListener("click", () => {
        //obtener todos los proyectos que me han compartido
        let getTypeElement = item.parentElement.getAttribute("data-article");
        let element = document.querySelectorAll(`#${getTypeElement}`);
        let sharedProjects = document.querySelectorAll("#projectShared");

        element.forEach((project) => {
          project.classList.add("hidden");

          sharedProjects.forEach((item) => {
            if (project === item) {
              project.classList.remove("hidden");
            }
          });
        });
      });
      break;
    case 3:
      item.addEventListener("click", () => {
        //proyectos
        let getTypeElement = item.parentElement.getAttribute("data-article");
        let element = document.querySelectorAll(`#${getTypeElement}`);

        element.forEach((item) => {
          item.classList.remove("hidden");
        });
      });
      break;
    default:
      console.error("Error al filtrar");
      break;
  }
});

//ELIMINAR PROYECTO
let delete_parcel = document.querySelectorAll("#delete-parcel");

delete_parcel?.forEach((item) => {
  item.addEventListener("click", async () => {
    let attr = item.getAttribute("data-id");

    const validation = await req.deleteProject(attr);

    if (!validation.state || !validation) {
      let errorMensaje = document.getElementById("danger");
      errorMensaje.style.display = "flex";
      errorMensaje.querySelector("#txt").textContent = validation.data;
      return;
    }

    window.location.reload();
  });
});

//CREAR PROYECTO
let createTemplate = document.querySelectorAll("#create-template");

createTemplate?.forEach((item) => {
  item.addEventListener("click", async () => {
    let attr = item.getAttribute("data-id");
    console.log(attr);
    const validation = await req.createProject(
      getCookie("ID-USER"),
      "Untitled",
      attr
    );

    console.log(validation);

    if (!validation.state || !validation) {
      let errorMensaje = document.getElementById("danger");
      errorMensaje.style.display = "flex";
      errorMensaje.querySelector("#txt").textContent = validation.data;
      return;
    }

    window.location.reload();
  });
});

//DUPLICAR PROYECTO
let duplicate_parcel = document.querySelectorAll("#duplicate-parcel");
duplicate_parcel?.forEach((item) => {
  item.addEventListener("click", async () => {
    let attr = item.getAttribute("data-id");

    const validation = await req.duplicateProject(attr);

    if (!validation.state || !validation) {
      let errorMensaje = document.getElementById("danger");
      errorMensaje.style.display = "flex";
      errorMensaje.querySelector("#txt").textContent = validation.data;
      return;
    }

    window.location.reload();
  });
});

let element_project = document.querySelectorAll("#element-project");

element_project?.forEach((item) => {
  item.addEventListener("click", function () {
    let attr = item.getAttribute("data-id");
    window.location.href = "/konva?id=" + attr;
  });
});

//? login

let formLogin = document.getElementById("form_login");
let formRegister = document.getElementById("form_signUp");

formRegister?.addEventListener("submit", async (e) => {
  e.preventDefault();
  let username = document.getElementById("name_register");
  let email = document.getElementById("email_register");
  let password = document.getElementById("password_register");

  if (username.value.length > 3 && validateEmail(email.value)) {
    const data_register = await req.registerUser(
      username.value,
      email.value,
      password.value
    );

    if (!data_register.state) {
      let errorMensaje = document.getElementById("danger");
      errorMensaje.style.display = "flex";
      errorMensaje.querySelector("#txt").textContent = data_register.data;
      return;
    }

    window.location.href = "/SignIn";
  }
});

formLogin?.addEventListener("submit", async (e) => {
  e.preventDefault();
  let email = document.getElementById("email_login");
  let password = document.getElementById("password_login");

  const validation = await req.loginUser(email.value, password.value);

  if (!validation.state || !validation) {
    let errorMensaje = document.getElementById("danger");
    errorMensaje.style.display = "flex";
    errorMensaje.querySelector("#txt").textContent = validation.data;
    return;
  }

  setCookie("ID-USER", validation.data.message);
  setCookie("logged", true);
  window.location.href = "/";
});

let logout = document.querySelector("#logout");
logout?.addEventListener("click", (e) => {
  e.preventDefault();
  setCookie("ID-USER", "", "0");
  setCookie("logged", "", "0");
  if (getCookie("ID-USER") != null || getCookie("logged") != null) {
    return;
  }
  window.location.reload();
});

//? settings
let openSetting = document.querySelector("#openSettings");
openSetting?.addEventListener("click", () => {
  let settings = document.querySelector("#settings");
  if (window.getComputedStyle(settings).display == "none") {
    settings.style.display = "flex";
  } else {
    settings.style.display = "none";
  }
});

let closeSetting = document.querySelectorAll("#closeSetting");
closeSetting.forEach((e) => {
  e?.addEventListener("click", () => {
    let settings = document.querySelector("#settings");
    if (window.getComputedStyle(settings).display == "flex") {
      settings.style.display = "none";
    } else {
      settings.style.display = "flex";
    }
  });
});

// funcionaliad de cambio de configuracion

let buttons_config = document.querySelectorAll("#button-config");

buttons_config?.forEach((item) => {
  item.addEventListener("click", () => {
    let section = item.getAttribute("data-section"); //El contenedor que abrira
    let section_show = document.querySelector(`.${section}`);
    section_show.style.display = "flex";

    document.querySelectorAll(".section-config").forEach((element) => {
      if (element != section_show) {
        element.style.display = "none";
      }
    });
  });
});

//funcionalidad de perfil
let userPhoto = document.querySelector("#userPhoto");
let change_userPhoto = document.querySelector("#inputfile");

change_userPhoto?.addEventListener("change", () => {
  const files = (event?.target).files;

  if (files && files[0]) {
    const reader = new FileReader();
    reader.onload = (e) => {
      let path = e.target?.result;
      userPhoto.style.backgroundImage = `url(${path})`;
    };
    reader.readAsDataURL(files[0]);
  }
});

function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function validatePassword(password) {
  const passwordRegex =
    /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  return passwordRegex.test(password);
}

function setCookie(name, value, days) {
  let expires = "";
  if (days) {
    const date = new Date();
    date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
    expires = "; expires=" + date.toUTCString();
  }
  document.cookie = name + "=" + (value || "") + expires + "; path=/";
}

function getCookie(name) {
  const nameEQ = name + "=";
  const ca = document.cookie.split(";");
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) == " ") c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length);
  }
  return null;
}

//Código para opciones del parcelador (borrar, duplicar y añadir a favoritos)
let moreOptionIcons = document.querySelectorAll('#more-options-icon')
let moreOptionDivs = document.querySelectorAll('#more-options-parceller')

moreOptionIcons.forEach((icon, index) => {
    icon.addEventListener("click", () => {
        const relatedOptionDiv = moreOptionDivs[index];
        if (window.getComputedStyle(relatedOptionDiv).display === "none") {
            relatedOptionDiv.style.display = "flex";
        } else {
            relatedOptionDiv.style.display = "none";
        }
    });
});
