import * as req from "../backend/requests";

// Utility Functions
const utils = {
toggleDisplay: (element, displayStyle) => {
  element.style.display = window.getComputedStyle(element).display === "none" ? displayStyle : "none";
},
setTransform: (element, angle) => {
  element.style.transform = `rotate(${angle}deg)`;
},
verifyCheck: (elementsInvite, elementChecked) => {
  elementsInvite.forEach((e, i) => {
    if (e !== elementChecked) {
      e.checked = false;
      utils.setBorder(elements.projectBox, i, false);
    } else {
      e.checked = true;
      utils.setBorder(elements.projectBox, i, true);
    }
  });
},
setBorder: (elements, index, isChecked) => {
  elements.forEach((e, i) => {
    if(isChecked && i === index){
      e.style.border = "2px solid rgb(147 197 253)"

      elements.forEach((e2, i2) => {
        if(e2 !== e){
          e2.style.border = "2px solid transparent"
        }
      })

    }
  });
},
changeStateWheelWindow: (state) => {
  const method = state ? 'addEventListener' : 'removeEventListener';
  ['wheel', 'mousewheel'].forEach(event => {
    window[method](event, utils.preventScroll, { passive: false });
  });
},
preventScroll: (event) => {
  event.preventDefault();
},
toggleHidden: (element, condition) => {
  element.classList.toggle("hidden", condition);
},
sortElements: (elements, key, ascending = true) => {
  const sorted = elements.sort((a, b) => {
    const valA = key === 'name' ? a.name : new Date(a.date);
    const valB = key === 'name' ? b.name : new Date(b.date);
    return ascending ? valA - valB : valB - valA;
  });
  sorted.forEach(item => item.element.parentElement.appendChild(item.element));
},
handleError: (validation) => {
  const errorMessage = document.getElementById("danger");
  errorMessage.style.display = "flex";
  errorMessage.querySelector("#txt").textContent = validation.data;
},
setCookie: (name, value, days) => {
  let expires = "";
  if (days) {
    const date = new Date();
    date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
    expires = "; expires=" + date.toUTCString();
  }
  document.cookie = name + "=" + (value || "") + expires + "; path=/";
},
getCookie: (name) => {
  const nameEQ = name + "=";
  const ca = document.cookie.split(";");
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) == " ") c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length);
  }
  return null;
},
validateEmail: (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}
};

// DOM Elements
const elements = {
projectBox: document.querySelectorAll("#parceler-box"),
projectSelected: document.querySelectorAll(".projectSelected"),
copyLink: document.getElementById("continue"),
usersInvited: document.getElementById("users-invited"),
projectContent: document.getElementById("projectContent"),
menuBtnList: document.querySelectorAll("#menu-btn"),
popupInvite: document.querySelector("#popup-invite"),
menuBtnList: document.querySelectorAll("#menu-btn"),
formLogin: document.getElementById("form_login"),
formRegister: document.getElementById("form_signUp"),
openSetting: document.querySelector("#openSettings"),
closeSettings: document.querySelectorAll("#closeSetting"),
userPhoto: document.querySelector("#userPhoto"),
changeUserPhoto: document.querySelector("#inputfile"),
moreOptionIcons: document.querySelectorAll('#more-options-icon'),
moreOptionDivs: document.querySelectorAll('#more-options-parceller')
};

console.log(elements)

// Event Listeners
const addEventListeners = () => {
// Filter dropdown
document.querySelectorAll("#filter").forEach((element, index) => {
  element?.addEventListener("click", () => {
    const moreOptionsFilter = document.querySelectorAll("#more-options-filter")[index];
    const arrowDownFilter = document.querySelectorAll("#arrow-down-filter")[index];
    utils.toggleDisplay(moreOptionsFilter, "flex");
    utils.setTransform(arrowDownFilter, window.getComputedStyle(moreOptionsFilter).display === "none" ? "0deg" : "180deg");
  });
});

// Profile options
document.querySelector("#profile")?.addEventListener("click", () => {
  utils.toggleDisplay(document.querySelector("#more-options-profile"), "flex");
});

// Slide items
document.querySelectorAll("#items-slide").forEach((element) => {
  element.addEventListener("click", () => {
    window.location.href = element.getAttribute("data-uri");
  });
});

// Mobile menu
document.querySelector("#menu-header")?.addEventListener("click", () => {
  const slide = document.querySelector("#slideMobile");
  slide.style.left = window.getComputedStyle(slide).left === "0px" ? "-100%" : "0%";
});

// Logo header
document.querySelector("#logo-header-slide")?.addEventListener("click", () => {
  window.location.href = document.querySelector("#logo-header-slide").getAttribute("data-action");
});

// Invite popup
document.querySelector("#bg-close-invite")?.addEventListener("click", () => {
  document.querySelector("#popup-invite").style.display = "none";
  if (window.getComputedStyle(elements.usersInvited).display === "flex") {
    elements.usersInvited.style.display = "none";
    elements.projectContent.style.display = "flex";
  }
});

document.querySelectorAll("#x-close-invite").forEach((element, i) => {
  element.addEventListener("click", () => {
    document.querySelector("#popup-invite").style.display = "none";
    if (i !== 0) {
      elements.usersInvited.style.display = "none";
      elements.projectContent.style.display = "flex";
    }
  });
});

// Project selection and invite popup
if (elements.copyLink) {
  elements.copyLink.disabled = true;
  elements.copyLink.style.opacity = "0.5";
}

elements.projectSelected.forEach((e, i) => {
  e.addEventListener("change", () => {
    utils.verifyCheck(elements.projectSelected, e);
    if (e.checked) {
      elements.copyLink.disabled = false;
      elements.copyLink.style.opacity = "1";
      elements.copyLink.addEventListener("click", () => {
        if (window.getComputedStyle(elements.usersInvited).display === "none") {
          elements.usersInvited.style.display = "flex";
          elements.projectContent.style.display = "none";
        }
      });
    } else {
      elements.copyLink.disabled = true;
      elements.copyLink.style.opacity = "0.5";
    }
  });
});

// Invite button
document.querySelectorAll("#invite-btn").forEach((element) => {
  element.addEventListener("click", () => {
    elements.popupInvite.style.display = "flex";
  });
});

// Menu buttons
elements.menuBtnList.forEach((element) => {
  element.addEventListener("click", () => {
    const attrElement = element.getAttribute("data-section");
    element.style.backgroundColor = "#FC7F53";
    element.style.borderColor = "#ad4b1e";
    elements.menuBtnList.forEach((item) => {
      if (item !== element) {
        item.style.backgroundColor = "#595959";
        item.style.borderColor = "transparent";
      }
    });
  });
});

// Slide controls
document.querySelector("#close-right-slide")?.addEventListener("click", () => {
  const rightSlide = document.querySelector("#right-slide");
  rightSlide.style.right = window.getComputedStyle(rightSlide).right === "0px" ? "-25rem" : "0px";
});

document.querySelector("#close-left-slide")?.addEventListener("click", () => {
  const leftSlide = document.querySelector("#left-slide");
  leftSlide.style.left = window.getComputedStyle(leftSlide).left === "0px" ? "-25rem" : "0px";
});

// Menu sections
elements.menuBtnList.forEach((element) => {
  element.addEventListener("click", () => {
    const attr = element.getAttribute("data-section");
    const sectionsOptions = document.querySelectorAll(".section_option");
    sectionsOptions.forEach((section) => {
      if (section.id === attr) {
        section.style.display = "flex";
        document.querySelector("#header-one").style.display = attr === "section_folders" ? "none" : "flex";
        document.querySelector("#header-two").style.display = attr === "section_folders" ? "flex" : "none";
      } else {
        section.style.display = "none";
      }
    });
  });
});

// Back to index
document.querySelector("#back-index")?.addEventListener("click", () => {
  window.location.href = "/";
});

// Context menu for projects
document.querySelectorAll("#element-project").forEach((item) => {
  item.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    utils.changeStateWheelWindow(true);
    const optionsParcel = item.parentNode.querySelector("#options-parcel");
    optionsParcel.style.display = "flex";
    optionsParcel.style.top = `${e.clientY}px`;
    optionsParcel.style.left = `${e.clientX}px`;

    document.addEventListener("click", () => {
      optionsParcel.style.display = "none";
      utils.changeStateWheelWindow(false);
    });
  });
});

// Search projects
document.querySelectorAll("#searchbar").forEach((item) => {
  item?.addEventListener("input", (e) => {
    const searchTerm = item.value.toLowerCase();
    const typeElement = item.getAttribute("data-article");
    const elementsToFilter = document.querySelectorAll(`#${typeElement}`);

    elementsToFilter.forEach((element) => {
      const name = element.getAttribute("data-name")?.toLowerCase();
      utils.toggleHidden(element, !name.includes(searchTerm));
    });
  });
});

// Filter options
document.querySelectorAll("#filtro").forEach((item, index) => {
  item.addEventListener("click", () => {
    const mainBox = item.parentElement.getAttribute("data-article");
    const elements = Array.from(document.querySelectorAll(`#${mainBox}`));

    switch (index) {
      case 0: // Sort by Name
        const namesAndElements = elements.map(el => ({
          name: el.getAttribute("data-name"),
          element: el
        }));
        const arrow = document.querySelector("#orden").firstChild.id;
        utils.sortElements(namesAndElements, 'name', arrow === 'arrowUp');
        break;

      case 1: // Sort by Date
        const datesAndElements = elements.map(el => ({
          date: el.getAttribute("data-modified"),
          element: el
        }));
        const arrowDate = item.children[1].firstChild.id;
        utils.sortElements(datesAndElements, 'date', arrowDate === 'arrowUp');
        break;

      case 2: // Show Shared Projects
        const sharedProjects = document.querySelectorAll("#projectShared");
        elements.forEach(project => {
          const isShared = Array.from(sharedProjects).includes(project);
          utils.toggleHidden(project, !isShared);
        });
        break;

      case 3: // Show All Projects
        elements.forEach(item => utils.toggleHidden(item, false));
        break;

      default:
        console.error("Error al filtrar");
    }
  });
});

// Delete project
document.querySelectorAll("#delete-parcel").forEach((item) => {
  item.addEventListener("click", async () => {
    const projectId = item.getAttribute("data-id");
    const validation = await req.deleteProject(projectId);

    if (!validation.state || !validation) {
      utils.handleError(validation);
      return;
    }

    window.location.reload();
  });
});

// Create project
document.querySelectorAll("#create-template").forEach((item) => {
  item.addEventListener("click", async () => {
    const templateId = item.getAttribute("data-id");
    const userId = utils.getCookie("ID-USER");
    const validation = await req.createProject(userId, "Untitled", templateId);

    if (!validation.state || !validation) {
      utils.handleError(validation);
      return;
    }

    window.location.reload();
  });
});

// Duplicate project
document.querySelectorAll("#duplicate-parcel").forEach((item) => {
  item.addEventListener("click", async () => {
    const projectId = item.getAttribute("data-id");
    const validation = await req.duplicateProject(projectId);

    if (!validation.state || !validation) {
      utils.handleError(validation);
      return;
    }

    window.location.reload();
  });
});

// Redirect to project
document.querySelectorAll("#element-project").forEach((item) => {
  item.addEventListener("click", () => {
    const projectId = item.getAttribute("data-id");
    window.location.href = `/konva?id=${projectId}`;
  });
});

// User authentication
elements.formRegister?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("name_register").value;
  const email = document.getElementById("email_register").value;
  const password = document.getElementById("password_register").value;

  if (username.length > 3 && utils.validateEmail(email)) {
    const dataRegister = await req.registerUser(username, email, password);

    if (!dataRegister.state) {
      utils.handleError(dataRegister);
      return;
    }

    window.location.href = "/SignIn";
  }
});

elements.formLogin?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("email_login").value;
  const password = document.getElementById("password_login").value;

  const validation = await req.loginUser(email, password);

  if (!validation.state || !validation) {
    utils.handleError(validation);
    return;
  }

  utils.setCookie("ID-USER", validation.data.message, 1);
  utils.setCookie("logged", true, 1);
  window.location.href = "/";
});

// Logout
document.querySelector("#logout")?.addEventListener("click", (e) => {
  e.preventDefault();
  utils.setCookie("ID-USER", "", -1);
  utils.setCookie("logged", "", -1);
  if (!utils.getCookie("ID-USER") && !utils.getCookie("logged")) {
    window.location.reload();
  }
});

// Settings
elements.openSetting?.addEventListener("click", () => {
  const settings = document.querySelector("#settings");
  utils.toggleDisplay(settings, window.getComputedStyle(settings).display === "none");
});

elements.closeSettings.forEach((e) => {
  e?.addEventListener("click", () => {
    const settings = document.querySelector("#settings");
    utils.toggleDisplay(settings, window.getComputedStyle(settings).display !== "flex");
  });
});

// Settings Configuration
document.querySelectorAll("#button-config").forEach((item) => {
  item.addEventListener("click", () => {
    const section = item.getAttribute("data-section");
    const sectionToShow = document.querySelector(`.${section}`);

    sectionToShow.style.display = "flex";

    document.querySelectorAll(".section-config").forEach((element) => {
      if (element !== sectionToShow) {
        element.style.display = "none";
      }
    });
  });
});

// User Profile
elements.changeUserPhoto?.addEventListener("change", (event) => {
  const files = event.target.files;
  if (files && files[0]) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const path = e.target.result;
      elements.userPhoto.style.backgroundImage = `url(${path})`;
    };
    reader.readAsDataURL(files[0]);
  }
});

// Parcel Options
elements.moreOptionIcons.forEach((icon, index) => {
  icon.addEventListener("click", () => {
    const relatedOptionDiv = elements.moreOptionDivs[index];
    utils.toggleDisplay(relatedOptionDiv, window.getComputedStyle(relatedOptionDiv).display === "none");
  });
});
};

// Initialize
const init = () => {
addEventListeners();
};

// Run initialization
init();