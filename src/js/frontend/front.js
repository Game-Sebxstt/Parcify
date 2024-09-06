import * as req from "../backend/requests";
import * as globals from './utilities/globals'
import * as templates from './utilities/templates'
import * as chart from './utilities/chart'
import * as reusable from './utilities/reusable'
import Toastify from 'toastify-js'
import { positionHighlight } from "astro/runtime/client/dev-toolbar/apps/utils/highlight.js";

// Utility Functions
export const utils = {
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
      if (isChecked && i === index) {
        e.style.border = "2px solid rgb(147 197 253)"

        elements.forEach((e2, i2) => {
          if (e2 !== e) {
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
    console.error(validation);
    Toastify({
      text: validation.data ?? validation,
      gravity: "bottom",
      position: "right",
      duration: 3000,
      close: true,
      style: {
        background: "#1E90FF",
      },
    }).showToast();
  },
  validateEmail: (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  },
  getCommitsByMonth: (data, startDate, endDate) => {
    const commitsByMonth = {};
    const start = new Date(startDate);
    const end = new Date(endDate);
  
    let current = new Date(start);
    while (current <= end) {
      const key = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
      commitsByMonth[key] = 0;
      current.setMonth(current.getMonth() + 1);
    }
  
    // Contar commits por mes
    data.forEach(item => {
      item.commits.forEach(commit => {
        const commitDate = new Date(commit.date);
        const commitMonth = `${commitDate.getFullYear()}-${String(commitDate.getMonth() + 1).padStart(2, '0')}`; // 'YYYY-MM'
        if (commitsByMonth[commitMonth] !== undefined) {
          commitsByMonth[commitMonth] += 1;
        }
      });
    });
  
    return commitsByMonth;
  },
  formatDataForChart:(commitsByMonth) => {
    const labels = Object.keys(commitsByMonth);
    const data = Object.values(commitsByMonth);

    return { labels, data };
  },
  createInput: (id, classInput, type, placeholder, value, parent) => {
    const input = document.createElement("input");
    input.id = id;
    input.className = classInput;
    input.type = type;
    input.placeholder = placeholder;
    input.value = value;

    parent.appendChild(input);
    return input;
  },
  showPreviewTemplate: (props) => {
    let tittlePrew  = document.querySelector("#tittlePreview")
    let authorPrew  = document.querySelector("#authorPreview")
    let infoPrew = document.getElementById("infoPreview")
    let infoDescription = document.getElementById("infoDescription")

    tittlePrew.textContent = props.dataName;
    authorPrew.textContent =  "By " + props.dataAuthor;
    infoPrew.src = props.dataPreview;
    infoDescription.textContent = props.dataDescription;

    elements.previewTemplate.setAttribute("data-id", props.dataId);

    window.getComputedStyle(elements.previewTemplate).display == "none" ? elements.previewTemplate.style.display = "flex" : elements.previewTemplate.style.display = "none";
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
  moreOptionDivs: document.querySelectorAll('#more-options-parceller'),
  template: document.querySelectorAll(".create-template"),
  previewTemplate: document.getElementById("previewTemplate"),
  favorite: document.querySelectorAll("#favorite"),
  unfavorite: document.querySelectorAll("#unfavorite"),
  createTemplate: document.querySelector("#createTemplate"),
  analytics: document.querySelector("#analytics"),
};

// Event Listeners
const addEventListeners = () => {
  // Filter dropdown
  document.querySelectorAll("#filter").forEach((element, index) => {
    element?.addEventListener("click", () => {
      const moreOptionsFilter = element.parentNode.querySelector("#more-options-filter");
      const arrowDownFilter = element.querySelector("#arrow-down-filter");

      console.log(moreOptionsFilter, arrowDownFilter)

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
    document.querySelector("body").style.overflow = window.getComputedStyle(slide).left === "0px" ? "auto" : "hidden";
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
    globals.endSession();
  });

  // Context menu for projects
  reusable.showContextMenu()

  //Metric for projects
  document.querySelectorAll("#metric-project").forEach((item) => {
    item.addEventListener("click", async () => {
      elements.analytics.style.display = window.getComputedStyle(elements.analytics).display === "none" ? "flex" : "none";
      const dataId = item.getAttribute("data-id");
      elements.analytics.setAttribute("data-id", dataId);
  
      const project = await req.getProject(dataId);
  
      if (!project.state) {
        utils.handleError(project);
        return;
      }
  
      const collaboratorsProject = JSON.parse(project.data.message.collaborators);
  
      const startDate = project.data.message.create_date;
      const endDate = new Date().toISOString();

      function createGraphicOfCommits(){
        const commits = collaboratorsProject.find(c => c.user_id === Number(globals.getCookie("ID-USER"))).commits;
        const labels = commits.map(c => c.date);
        const data = commits.map(c => c.commits);

        chart.createGraphic(
          document.querySelector("#commits"),
          "bar",
          startDate,
          endDate,
          data,
          labels,
          "rgba(147, 197, 253, 0.2)",
          "rgb(147, 197, 253)",
          1
        );
      }
  
      function createGraphicOfTimeWorked() {
        const timeWorked = collaboratorsProject.find(c => c.user_id === Number(globals.getCookie("ID-USER"))).time_worked;
        const labels = timeWorked.map(c => c.date);
        const data = timeWorked.map(c => c.time);

        chart.createGraphic(
          document.querySelector("#time_worked"),
          "line",
          startDate,
          endDate,
          data,
          labels,
          "rgba(147, 197, 253, 0.2)",
          "rgb(147, 197, 253)",
          1
        );
      }

      createGraphicOfCommits();
      createGraphicOfTimeWorked();

    });
  });

  // Search projects
  document.querySelectorAll("#searchbar").forEach((item) => {
    item?.addEventListener("input", (e) => {
      const searchTerm = item.value.toLowerCase();
      const typeElement = item.getAttribute("data-article");
      const elementsToFilter = document.querySelectorAll(`.${typeElement}`) || document.querySelectorAll(`#${typeElement}`);

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
      const elements = Array.from(document.querySelectorAll(`.${mainBox}`) || document.querySelectorAll(`#${mainBox}`));

      switch (index) {
        case 0: // Sort by Name
        const namesAndElements = elements.map(el => ({
          name: el.getAttribute("data-name").toLowerCase(),  // Use lowercase for consistent comparison
          element: el
        }));

        const arrow = document.querySelector("#orden").firstChild.id;
        
        // Sort elements by name
        namesAndElements.sort((a, b) => {
          if (a.name < b.name) return arrow === 'arrowUp' ? -1 : 1;
          if (a.name > b.name) return arrow === 'arrowUp' ? 1 : -1;
          return 0;
        });

        // Append sorted elements back to the DOM
        namesAndElements.forEach(item => {
          item.element.parentElement.appendChild(item.element);
        });
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

  // Create project
  elements.createTemplate?.addEventListener("click",  async () => {
    const templateId = elements.previewTemplate.getAttribute("data-id");
    const userId = globals.getCookie("ID-USER");

    const validation = await req.createProject(userId, "Untitled", templateId);

    if (!validation.state || !validation) {
      utils.handleError(validation);
      return;
    }
    
    const props = {
        name: "Untitled",
        last_modified: new Date(),
        project_id: validation.data.message.project_id,
        preview: validation.data.message.preview,
        stage: validation.data.message.stage,
        collaborators: validation.data.message.collaborators,
    }

    if(!document.querySelector("#content-grid")){
      window.location.href = "/"
      return
    }

    templates.renderProject(props, document.querySelector("#content-grid"));
  });

  // Duplicate project
  document.querySelectorAll("#duplicate-parcel").forEach((item) => {
    item.addEventListener("click", async () => {
      const projectId = document.querySelector("#options-parcel").getAttribute("data-id");
      const validation = await req.duplicateProject(projectId);

      if (!validation.state || !validation) {
        utils.handleError(validation);
        return;
      }

      const props = {
          name: validation.data.message.name,
          last_modified: new Date(),
          project_id: validation.data.message.project_id,
          preview: validation.data.message.preview,
          stage: validation.data.message.stage,
          collaborators: validation.data.message.collaborators,
      }

      if(!document.querySelector("#content-grid")){
        window.location.href = "/"
        return
      }

      templates.renderProject(props, document.querySelector("#content-grid"));
      });
  });

  // Delete project
  document.querySelectorAll("#delete-parcel").forEach((item) => {
    item.addEventListener("click", async () => {
      const projectId = document.querySelector("#options-parcel").getAttribute("data-id");
      const validation = await req.deleteProject(projectId);
      
      if (!validation.state || !validation) {
        utils.handleError(validation);
        return;
      }

      templates.deleteProject(projectId);
      await req.unfavorite(globals.getCookie("ID-USER"), projectId);
    
      const renderResponse = await templates.renderFavorites()

      if(!renderResponse){
        utils.handleError(renderResponse)
        return
      }
    });
  });
    
  // Rename project
  document.querySelector("#rename-parcel")?.addEventListener("click", async () => {
    const projectId = document.querySelector("#options-parcel").getAttribute("data-id");
    const projectContent = document.querySelector(`#element-project[data-id="${projectId}"]`).parentNode;
  
    if (!projectContent) {
      utils.handleError(`Could not find project with id ${projectId}`);
      return;
    }
  
    const h3 = projectContent.querySelector('#name-of-parcel');
    const input = projectContent.querySelector('#input-of-parcel');
  
    h3.style.display = "none";
    input.style.display = "flex";
  
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  
    const saveChanges = async () => {
      console.log("Save changes");
      const validation = await req.renameProject(projectId, input.value);
  
      if (!validation.state) {
        utils.handleError(validation);
  
        h3.style.display = "flex";
        input.style.display = "none";
        input.value = h3.textContent;
  
        return;
      }
  
      h3.textContent = input.value;
      h3.style.display = "flex";
      input.style.display = "none";
  
      templates.renameProject(projectId, input.value);
  
      const renderResponse = await templates.renderFavorites();
  
      if (!renderResponse) {
        utils.handleError(renderResponse);
        return;
      }

      return
    };
  
    const cancelChanges = () => {
      h3.style.display = "flex";
      input.style.display = "none";
      input.value = h3.textContent;
    };
  
    const handleKeydown = (e) => {
      if (e.key === "Enter") {
        saveChanges();
        input.removeEventListener("blur", handleBlur);
        input.removeEventListener("keydown", handleKeydown);
      }
  
      if (e.key === "Escape") {
        cancelChanges();
        input.removeEventListener("blur", handleBlur);
        input.removeEventListener("keydown", handleKeydown);
      }
    };
  
    const handleBlur = () => {
      saveChanges();
    };
  
    input.addEventListener("keydown", handleKeydown);
    input.addEventListener("blur", handleBlur);
  });

  // Redirect to project
  reusable.redirectProject();

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

    globals.setCookie("ID-USER", validation.data.message, 1);
    globals.setCookie("logged", true, 1);
    window.location.href = "/";
  });

  // Logout
  document.querySelector("#logout")?.addEventListener("click", (e) => {
    e.preventDefault();
    globals.setCookie("ID-USER", "", -1);
    globals.setCookie("logged", "", -1);
    if (!globals.getCookie("ID-USER") && !globals.getCookie("logged")) {
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

  //previewParceller
  elements.template.forEach((item) => {
    item.addEventListener("click", (e) => {
      const dataId = item.getAttribute("data-id");
      const dataName = item.getAttribute("data-name");
      const dataAuthor = item.getAttribute("data-author");
      const dataPreview = item.getAttribute("data-preview");
      const dataDescription = item.getAttribute("data-description");

      utils.showPreviewTemplate({
        dataId,
        dataName,
        dataAuthor,
        dataPreview,
        dataDescription
      })
    });
  });

  elements.previewTemplate.querySelector("#share").addEventListener("click", () => {
    const dataId = elements.previewTemplate.getAttribute("data-id");
    const urlCopy = `${window.location.origin}/?template_id=${dataId}`;
    navigator.clipboard.writeText(urlCopy);

    utils.handleError("Link copied to clipboard");
  })

  //favorites
  elements.favorite.forEach(item =>{
    item.addEventListener("click", async ()=>{
      const userId = globals.getCookie("ID-USER");
      const idElement = Number(document.querySelector("#options-parcel").getAttribute("data-id"));
      const typeElement = document.querySelector("#options-parcel").getAttribute("data-type");
      
      const data = {
        id_project:idElement,
        type:typeElement,
      }

      const petition = await req.favorite(userId, data);

      if (!petition.state) {
        utils.handleError(petition)
        return petition.data;
      }
    
      const renderResponse = await templates.renderFavorites()

      if(!renderResponse){
        utils.handleError(renderResponse)
        return
      }
    });
  });

  //unfavorite
  elements.unfavorite.forEach((item)=>{
    item.addEventListener("click", async ()=>{
      const userId = globals.getCookie("ID-USER");
      const idElement = Number(document.querySelector("#options-parcel").getAttribute("data-id"));
      const petition = await req.unfavorite(userId, idElement);

      if (!petition.state) {
        utils.handleError(petition)
        return petition.data;
      }
    
      const renderResponse = await templates.renderFavorites()

      if(!renderResponse){
        utils.handleError(renderResponse)
        return
      }
    })
  });
};

// Initialize
const init = () => {
  addEventListeners();
};

// Run initialization
init();

// ------------------------- Show settings content -------------------------------
// Options buttons
const profileOption = document.querySelector('#profile-option')
const appareanceOption = document.querySelector('#appareance-option')
const securityOption = document.querySelector('#security-option')

//Content buttons
const profileContent = document.querySelector('#profile-content')
const appareanceContent = document.querySelector('#appareance-content')
const securityContent = document.querySelector('#security-content')

profileOption?.addEventListener("click", () => {

    profileContent.style.display = "flex";
    appareanceContent.style.display = "none";
    securityContent.style.display = "none";
});

appareanceOption?.addEventListener("click", () => {
  profileContent.style.display = "none";
    appareanceContent.style.display = "flex";
    securityContent.style.display = "none";
});

securityOption?.addEventListener("click", () => {
  profileContent.style.display = "none";
    appareanceContent.style.display = "none";
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


//Edit Username
document.querySelector('#edit-icon-username')?.addEventListener("click", async () => {
  const editIcon = document.querySelector("#edit-icon-username");
  const usernameInput = document.querySelector("#profile-username");
  const optionsButtons = document.querySelector("#options-buttons-profile");

  usernameInput.removeAttribute("readonly");
  usernameInput.style.opacity = 1;
  usernameInput.value = "";
  usernameInput.focus();

  optionsButtons.style.display = "flex";
  editIcon.style.pointerEvents = "none";
  editIcon.style.opacity = '0.5';

  document.querySelector("#options-buttons-profile").addEventListener("click", async () => {
    const userId = globals.getCookie("ID-USER");
    const usernameInput = document.querySelector("#profile-username");
    const newUsername = usernameInput.value;
  
    if(!newUsername.trim()){
      utils.handleError("Please enter a username valid")
    }

    const validation = await req.updateProfile({
      id: userId,
      username: newUsername
    });

    if(!validation.state){
      utils.handleError(validation);
      return;
    }

    usernameInput.setAttribute("readonly", "");
    usernameInput.style.opacity = 0.5;
    optionsButtons.style.display = "auto";
    editIcon.style.opacity = '1';

    window.location.reload();

  })
});

//Seleccionar theme (diseño)
document?.addEventListener('DOMContentLoaded', () => {
  const themeOptions = document.querySelectorAll('.theme-option');

  themeOptions.forEach(option => {
      option?.addEventListener('click', () => {
          themeOptions.forEach(item => item.classList.remove('border-4', 'border-blue-500', 'shadow-lg'));

          option.classList.add('border-4', 'border-blue-500', 'shadow-lg');
      });
  });
});

//Chequear el email
document.querySelector('#edit-icon-email')?.addEventListener("click", async () => {
  const emailInput = document.querySelector('#profile-email');
  const editIcon = document.querySelector('#edit-icon-email');
  // const confirmationDiv = document.createElement("div")

  const contentEditEmail = document.querySelector('#div-edit-email');
  const optionsButtons = document.querySelector('#options-buttons-profile');

  if(document.querySelectorAll(".containerEditEmail").length > 0){
    return;
  }
  
  for(let i = 0; i < 2; i++){
    const containerEmailInput = document.createElement("div");
    containerEmailInput.className = "w-full flex items-center containerEditEmail";
  
    contentEditEmail.appendChild(containerEmailInput);

    const inputEmail = templates.getCloneInputEmail(containerEmailInput)
    inputEmail.focus();
  }

  optionsButtons.style.display = "flex";

  const saveChanges = document.querySelector('#button-save-changes');
  saveChanges.addEventListener("click", async () => {
    const userId = globals.getCookie("ID-USER");
    const currentEmails = document.querySelectorAll(".containerEditEmail");

    if(currentEmails[0].querySelector("input").value != currentEmails[1].querySelector("input").value){
      console.log("Los correos no son iguales");
      utils.handleError("The emails are not the same");
      return;
    }

    const validationEmail = await req.updateProfile({
      id: userId,
      email: currentEmails[0].querySelector("input").value
    });

    if(!validationEmail.state){
      utils.handleError(validationEmail);
      return;
    }

    window.location.reload();
  })
});

//iniciar el modo de edición de contraseña
document.querySelector('#edit-icon-password')?.addEventListener('click', async () => {
  const editIcon = document.querySelector('#edit-icon-password');
  const passwordInput = document.querySelector('#password');

  passwordInput.removeAttribute("readonly");
  passwordInput.style.opacity = 1;
  passwordInput.value = "";
  passwordInput.focus();

  editIcon.style.pointerEvents = 'none';
  editIcon.style.opacity = '0.5';

  const comparePassword = async () => {
    const optionsButtons = document.querySelector('#options-buttons-password');
    const inputsEdits = document.querySelector('#edit-password');
    const inputNewPassword = document.querySelector('#newPassword');

    const userId = globals.getCookie("ID-USER");
    const currentPassword = passwordInput.value;
    
    const validation = await req.checkPassword(userId, currentPassword);

    if (validation.state) {
      inputsEdits.style.display = "flex";
      passwordInput.setAttribute("readonly", true);
      optionsButtons.style.display = "flex";
      inputNewPassword.focus();
    } else {
      utils.handleError(validation);
    }
  };

  const saveChangesButton = document.querySelector("#button-save-security");
  saveChangesButton?.addEventListener('click', async () => {
  const newPassword = document.querySelector('#newPassword').value;
  const confirmNewPassword = document.querySelector('#confirmNewPassword').value;
  const userId = globals.getCookie('ID-USER');

    if (newPassword === confirmNewPassword){
      const updatePassword = await req.updatePassword(userId, newPassword);
      
      if (updatePassword.state) {
        window.location.reload();
      } else {
        utils.handleError("Error al actualizar la contraseña.");
      }
    } else {
      console.log("No son iguales :(");
      utils.handleError("Las contraseñas no coinciden.");
    }
  });

  passwordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      console.log("Se presionó Enter");
      comparePassword();
    }
  });
});

document.querySelector("#textarea-biography")?.addEventListener("click", () => {

  const textareaBiography = document.querySelector('#textarea-biography');
  const optionButtons = document.querySelector('#options-buttons-profile');
  const saveChanges = document.querySelector('#button-save-changes');
  const cancelChanges = document.querySelector('#button-cancel-changes');

  textareaBiography?.addEventListener("input", () =>{
    optionButtons.style.display = "flex";
  })

  const updateBiography = async () => {
    const userId = globals.getCookie("ID-USER");
    const biography = textareaBiography.value;

    if (biography.trim() === "") {
      console.log("Esa mondá no puede estar en blanco");
      
    }

    const validation = await req.updateProfile({
      id: userId,
      biography: biography
    });

    if(!validation.state){
      utils.handleError(validation);
      return;
    }

    window.location.reload(); 
  }

  saveChanges.addEventListener("click",updateBiography);

  cancelChanges.addEventListener("click", () => {
    textareaBiography.value = "";
    optionButtons.style.display = "none";
    window.location.reload();
  });
});