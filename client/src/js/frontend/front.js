import * as req from "../backend/requests";
import * as globals from './utilities/globals'
import * as templates from './utilities/templates'
import * as chart from './utilities/chart'
import * as reusable from './utilities/reusable'
import Toastify from 'toastify-js'

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
        elements.copyLink.setAttribute("data-id", elementChecked.getAttribute("id"));
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
  showPreviewTemplate: async (props) => {
    let tittlePrew  = document.querySelector("#tittlePreview")
    let authorPrew  = document.querySelector("#authorPreview")
    let infoPrew = document.getElementById("infoPreview")
    let infoDescription = document.getElementById("infoDescription")

    tittlePrew.textContent = props.dataName;
    authorPrew.textContent =  "By " + props.dataAuthor;
    infoPrew.src = props.dataPreview;
    infoDescription.textContent = props.dataDescription;

    elements.previewTemplate.setAttribute("data-id", props.dataId);

    let favorites = await req.getFavorites(globals.getCookie("ID-USER"));
    if (favorites.state) {
      favorites = JSON.parse(favorites.data.message[0].favorites)
      const isFavorite = favorites.find(favorite => favorite.id == props.dataId);
      elements.favoriteTemplate.style.fill = isFavorite ? "#f4d462" : "none"
    }

    let templates = await req.getTemplate(props.dataId);
    if(templates.state){
      let template_likes = JSON.parse(templates.data.message.likes);
      const isLiked = template_likes.find(template => template.user_id == globals.getCookie("ID-USER"));
      elements.heartTemplate.style.fill = isLiked ? "#f46262" : "none"
    }

    window.getComputedStyle(elements.previewTemplate).display == "none" ? elements.previewTemplate.style.display = "flex" : elements.previewTemplate.style.display = "none";
  },
  isSelected: (element) => {
      if (!recourses.selectedElements.includes(element)) {
          const selectionIdentifier = element.querySelector("#selectionIdentifier");
          selectionIdentifier.style.display = "flex";
          recourses.selectedElements.push(element);
      }
  },
  isDeselected: (element) => {
      const selectionIdentifier = element.querySelector("#selectionIdentifier");
      selectionIdentifier.style.display = "none";
      recourses.selectedElements = recourses.selectedElements.filter(selected => selected !== element);
  },
  clear: () => {
      document.querySelectorAll(".project").forEach(item => { utils.isDeselected(item) });
      recourses.selectedElements = [];
      recourses.lastIndex = null;
  }
};

// DOM Elements
export const elements = {
  projectBox: document.querySelectorAll("#parceler-box"),
  projectSelected: document.querySelectorAll(".projectSelected"),
  copyLink: document.getElementById("continue"),
  usersInvited: document.getElementById("users-invited"),
  projectContent: document.getElementById("projectContent"),
  menuBtnList: document.querySelectorAll("#menu-btn"),
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
  favoriteTemplate:document.querySelector("#favoriteTemplate"),
  shareTemplate:document.querySelector("#shareTemplate"),
  heartTemplate:document.querySelector("#heartTemplate"),
  moreFavorites:document.querySelector("#moreFavorites"),
  createTemplate: document.querySelector("#createTemplate"),
  analytics: document.querySelector("#analytics"),
  imageContainer: document.querySelectorAll('#image-container'),//yo
  imageUpload: document.getElementById('image-upload'),
  themeOptions: document.querySelectorAll(".theme-option"),
  fontSelect: document.querySelector('select[name="Font theme"]'),//
  openDesplegableMenuKonva: document.querySelector("#openMenuDesplegableKonva"),
  moreOptionsFilter: document.querySelector("#more-options-filter"),
  desplegableMenuKonva:document.querySelector("#desplegableMenuKonva"),
  authCodeContainer: document.querySelector("#authCodeContainer"),
  authCodeClose: document.querySelector("#close-authCode"),
  authCodeVerificate: document.querySelector("#authCodeVerificate"),
  resendCodeAuth: document.querySelector("#resendCodeAuth")
};

//Seleccionar theme (diseño)
const configs = {
  theme: localStorage.getItem('selectedTheme') || "",
  font: localStorage.getItem('selectedFont') || "",
};

// Recursos reutilizables
export let recourses = {
  selectedElements: [],
  lastIndex: null,
  isSelectionCtrl: false,
  isSelectionShift: false,
}

// Event Listeners
const addEventListeners = () => {

  // window.addEventListener('beforeunload', async (e) => {
  //   e.preventDefault();
  //   const email = document.getElementById("email_register").value;
  //   const cancelRegister = await req.cancelVerificateCode(email);
  //   if (!cancelRegister.state) {
  //     utils.handleError(cancelRegister);
  //     return;
  //   }
  // });

  document.addEventListener("keydown", (press) => {
      if (press.shiftKey) {
          recourses.isSelectionShift = true;
          document.body.style.userSelect = "none"
      } else if (press.ctrlKey || press.metaKey) {
          recourses.isSelectionCtrl = true;
      }
  });
  
  document.addEventListener("keyup", (press) => {
      if (press.key === "Shift") {
          recourses.isSelectionShift = false;
          document.body.style.userSelect = "auto"
      } else if (press.key === "Control" || press.key === "Meta") {
          recourses.isSelectionCtrl = false;
      }
  });

  elements.openDesplegableMenuKonva?.addEventListener("click", ()=>{
    window.getComputedStyle(elements.desplegableMenuKonva).display == "none" ? elements.desplegableMenuKonva.style.display = "flex" : elements.desplegableMenuKonva.style.display = "none";
  });

  // Filter dropdown
  document.querySelectorAll("#filter").forEach((element, index) => {
    element?.addEventListener("click", () => {
      const moreOptionsFilter = element.parentNode.querySelector("#more-options-filter");
      const arrowDownFilter = element.querySelector("#arrow-down-filter");

      utils.toggleDisplay(moreOptionsFilter, "flex");
      utils.setTransform(arrowDownFilter, window.getComputedStyle(moreOptionsFilter).display === "none" ? "0deg" : "180deg");
    });
  });

  elements.moreOptionsFilter?.childNodes.forEach((element) => {
    element.addEventListener("click", () => {
      const text = element.textContent;
      const role = element.getAttribute("data-role");
      const filter = element.parentNode.parentNode.querySelector("#text-select");
      filter.setAttribute("data-role", role);
      filter.textContent = text;
      utils.toggleDisplay(element.parentNode, "none");
    });
  })

  // Profile options
  document.querySelector(".profile")?.addEventListener("click", () => {
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
            elements.usersInvited.setAttribute("data-id", e.getAttribute("id"));
            elements.projectContent.style.display = "none";
          }
        });
      } else {
        elements.copyLink.disabled = true;
        elements.copyLink.style.opacity = "0.5";
      }
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

  // Events listener projects and favorites
  reusable.eventsListenerProjects();
  reusable.eventsListenerFavorites();

  // send template to Favorite
  elements.favoriteTemplate?.addEventListener("click", async ()=>{
    const userId = globals.getCookie("ID-USER")
    const templateId = elements.previewTemplate.getAttribute("data-id")

    const data = {
      id_project: templateId,
      type: "template",
    }

    if(window.getComputedStyle(elements.favoriteTemplate).fill != "none"){
      elements.favoriteTemplate.style.fill = "none"
      const petition = await req.unfavorite(userId, templateId)

      if (!petition.state) {
        utils.handleError(petition);
        return petition.data
      }
    }else{
      elements.favoriteTemplate.style.fill = "#f4d462"
      const petition = await req.favorite(userId, data)

      if (!petition.state) {
        utils.handleError(petition);
        return;
      }
    }

    const renderResponse = await templates.renderFavorites()

    if(!renderResponse){
      utils.handleError(renderResponse)
      return
    }
  });

  // Share template
  elements.shareTemplate?.addEventListener("click", () => {
    elements.shareTemplate.style.fill = "white"
    const dataId = elements.previewTemplate.getAttribute("data-id");
    const urlCopy = `${window.location.origin}/?id_project=${dataId}`;
    navigator.clipboard.writeText(urlCopy);

    utils.handleError("Link copied to clipboard");
  })

  // Like template
  elements.heartTemplate?.addEventListener("click", async () => {
    const userId = globals.getCookie("ID-USER")
    const templateId = elements.previewTemplate.getAttribute("data-id")

    if(window.getComputedStyle(elements.heartTemplate).fill != "none"){
      elements.heartTemplate.style.fill = "none"
      const petition = await req.dislikeTemplate(templateId, userId)

      if (!petition.state) {
        utils.handleError(petition);
        return petition.data
      }
    }else{
      elements.heartTemplate.style.fill = "#f46262"
      const petition = await req.likeTemplate(templateId, userId)

      if (!petition.state) {
        utils.handleError(petition);
        return;
      }
    }
  })

  // Metric for projects
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
        const dataSet = [];

        collaboratorsProject.forEach(collaborator => {
          dataSet.push({
            label: collaborator.name,
            data: collaborator.commits.map(c => c.commits),
            backgroundColor: globals.hexToRGBA(collaborator.color.hex, .2),
            borderColor: collaborator.color.hex,
            borderWidth: 1,
            fill: false,
          });
        })

        const labels = commits.map(c => c.date);

        chart.createGraphic(
          document.querySelector("#commits"),
          "bar",
          startDate,
          endDate,
          dataSet,
          labels
        );
      }
  
      function createGraphicOfTimeWorked() {
        const timeWorked = collaboratorsProject.find(c => c.user_id === Number(globals.getCookie("ID-USER"))).time_worked;
        const labels = timeWorked.map(c => c.date);
        const dataSet = []

        collaboratorsProject.forEach(collaborator => {
          dataSet.push({
            label: collaborator.name,
            data: collaborator.time_worked.map(c => c.time),
            backgroundColor: globals.hexToRGBA(collaborator.color.hex, .2),
            borderColor: collaborator.color.hex,
            borderWidth: 1,
            fill: false,
          });
        })

        chart.createGraphic(
          document.querySelector("#time_worked"),
          "line",
          startDate,
          endDate,
          dataSet,
          labels,
        );
      }

      createGraphicOfCommits();
      createGraphicOfTimeWorked();

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

  // filter template
  document.querySelectorAll("#filtroTemplate").forEach((item, index) => {
    item.addEventListener("click", async () => {
        const mainBox = item.parentElement.getAttribute("data-article");
        const elements = Array.from(document.querySelectorAll(`#${mainBox}`));
        
        switch (index) {
            case 0:
                const namesAndElements = elements.map(el => ({
                    name: el.getAttribute("data-name").toLowerCase(),
                    element: el
                }));
                
                const arrow = document.querySelector("#orden").firstChild.id;

                namesAndElements.sort((a, b) => {
                    if (a.name < b.name) return arrow === 'arrowUp' ? -1 : 1;
                    if (a.name > b.name) return arrow === 'arrowUp' ? 1 : -1;
                    return 0;
                });

                namesAndElements.forEach(item => {
                    item.element.parentElement.appendChild(item.element);
                });
                break;

            case 1:
                const templates_db = await req.getAllTemplates();
                let templates_data = templates_db.data.message;

                const arrowDate = item.children[1].firstChild.id;

                templates_data = globals.sortByKey(templates_data, "date_create", arrowDate === 'arrowUp' ? 'asc' : 'desc');
                
                const contentGrid = document.querySelector("#content-grid-templates");
                if(!contentGrid){
                    utils.handleError("No se encontró el contenedor de los templates");
                    return;
                }

                contentGrid.innerHTML = ""

                const templateVoid = {
                  template_id: 0,
                  name: "Plantilla vacia",
                  autor: "Parcify",
                  description: "Plantilla vacia",
                  likes: null,
                }

                templates_data = [templateVoid, ...templates_data];

                templates_data.forEach( async (template) => {
                  const props = {
                    template_id: template.template_id,
                    name: template.name,
                    author: template.autor,
                    preview: template.preview,
                    description: template.description,
                    likes: template.likes,
                  }

                  templates.renderTemplate(props, contentGrid);
                });
                break;

          case 2:
            const sharedProjects = document.querySelectorAll("#projectShared");
            elements.forEach(project => {
                const isShared = Array.from(sharedProjects).includes(project);
                utils.toggleHidden(project, !isShared);
            });
          break;

          case 3:
            elements.forEach(item => utils.toggleHidden(item, false));
          break;

          default:
          console.error("Error al filtrar");
      }
    });
  });

  // Open project
  document.querySelector("#redirect")?.addEventListener("click", () => {
    const projectId = document.querySelector("#options-parcel").getAttribute("data-id");
    reusable.redirectProjectAction(projectId);
  })

  // Open project external
  document.querySelector("#redirect-external")?.addEventListener("click", () => {
    const projectId = document.querySelector("#options-parcel").getAttribute("data-id");
    reusable.redirectProjectAction(projectId, true);
  })
  
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
      const elements_select = recourses.selectedElements;
      let id_selects = [];

      if (elements_select.length > 1) {
        elements_select.forEach((element) => {
          id_selects.push(element.querySelector("#element-project").getAttribute("data-id"));
        });

        const validation = await req.duplicateListProjects(id_selects);

        if (!validation.state || !validation) {
          utils.handleError(validation);
          return;
        }

        validation.data.message.forEach(async (project) => {
          const props = {
              name: project.name,
              last_modified: new Date(),
              project_id: project.project_id,
              preview: project.preview,
              stage: project.stage,
              collaborators: project.collaborators,
          }

          if(!document.querySelector("#content-grid")){
            utils.handleError("No se encontró el contenedor de los proyectos");
            return
          }

          templates.renderProject(props, document.querySelector("#content-grid"));
        })
      }else{
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
          utils.handleError("No se encontró el contenedor de los proyectos");
          return
        }

        templates.renderProject(props, document.querySelector("#content-grid"));
      }
    });
  });

  // Delete project
  document.querySelectorAll("#delete-parcel").forEach((item) => {
    item.addEventListener("click", async () => {
      const elements_select = recourses.selectedElements;
      let id_selects = [];

      console.log(elements_select)
      if (elements_select.length > 1) {
        elements_select.forEach((element) => {
          id_selects.push(element.querySelector("#element-project").getAttribute("data-id"));
        });
        
        const validation = await req.deleteListProjects(id_selects);

        if (!validation.state || !validation) {
          utils.handleError(validation);
          return;
        }

        id_selects.forEach(async (id) => {
          templates.deleteProject(id);
          await req.unfavorite(globals.getCookie("ID-USER"), id);
        })

        const renderResponse = await templates.renderFavorites();

        if (!renderResponse) {
          utils.handleError(renderResponse);
          return;
        }
      }else{
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
      }
    });
  });
    
  // User authentication
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
  reusable.showPreviewTemplate();

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
