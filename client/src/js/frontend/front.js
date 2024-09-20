import * as req from "../backend/requests";
import * as globals from './utilities/globals'
import * as chart from './utilities/chart'
import * as reusable from './utilities/reusable'
import * as environment_utils from '../globals/environment-utils'
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
  },
  updatePerformanceMetrics: (collaborator, collaboratorsProject) => {
    const analytics = document.querySelector("#analytics");
    const total_pages = analytics.querySelector("#total-pages");
    const total_elements = analytics.querySelector("#total-elements");
    const total_groups = analytics.querySelector("#total-groups");
    const most_used_element = analytics.querySelector("#most-used-element");

    const stageProject = environment_utils.getStageOfProject(collaborator.project_id)
    const elementsInLayer = stageProject.children.find(c => c.attrs.id == "layer").children.filter(c => c.attrs.id != "selection");
    console.log(elementsInLayer);
    const elementCounts = {};
    const number_groups = elementsInLayer.filter(c => c.className == "Group").length;
    let mostUsedElement;

    if(elementsInLayer.length > 0){
      elementsInLayer.forEach(element => {
        const type = element.className
        if(type == "Group") return;

        elementCounts[type] = (elementCounts[type] || 0) + 1;
      })

      console.log(elementCounts);

      if(Object.keys(elementCounts).length > 0){
        mostUsedElement = Object.keys(elementCounts).reduce((a, b) => elementCounts[a] > elementCounts[b] ? a : b);
      }else{
        mostUsedElement = undefined;
      }
    }

    const today = new Date();

    function getDaysDifference(date1, date2) {
      const diffTime = Math.abs(date2 - date1);
      return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    const commits_collaborators = collaboratorsProject.map(c => {
      const recentCommits = c.commits.filter(commit => {
        const commitDate = new Date(commit.date);
        const daysDifference = getDaysDifference(commitDate, today);
        return daysDifference <= 30;
      });

      const totalCommitsLast30Days = recentCommits.reduce((acc, commit) => acc + commit.commits, 0);

      return {
        user_id: c.user_id,
        totalCommitsLast30Days,
      };
    });

    most_used_element.textContent = mostUsedElement == undefined ? "Ninguno" : `${mostUsedElement} (${elementCounts[mostUsedElement]} veces)`;
    total_pages.textContent = collaborator.pages_created;
    total_elements.textContent = elementsInLayer.length;
    total_groups.textContent = number_groups;
  },
  updateWorkMetrics: (collaborator, collaboratorsProject) => {
    const analytics = document.querySelector("#analytics");
    const averageTimeElem = analytics.querySelector("#average-time");
    const totalChangesElem = analytics.querySelector("#total-changes");
    const totalCommentsElem = analytics.querySelector("#total-comments");
    const totalTimeWorkedElem = analytics.querySelector("#total-time-worked");

    // Inicializar acumuladores
    let totalMinutesWorked = 0;
    let totalChanges = 0;
    let totalComments = 0;
    let timeRecordsCount = 0;

    // Recorrer todos los colaboradores
    collaboratorsProject.forEach(collaborator => {
        const timeWorked = collaborator.time_worked || [];
        totalMinutesWorked += timeWorked.reduce((total, record) => total + record.time, 0);
        collaborator.commits.forEach(commits => {
            totalChanges += commits.commits || 0;
        })
        totalComments += collaborator.comments || 0;
        timeRecordsCount += timeWorked.length;
    });

    // Calcular el tiempo promedio de trabajo
    const averageMinutesWorked = timeRecordsCount > 0 ? totalMinutesWorked / timeRecordsCount : 0;

    // Actualizar el contenido del HTML
    averageTimeElem.textContent = globals.formatTimeMinute(averageMinutesWorked);
    totalChangesElem.textContent = totalChanges;
    totalCommentsElem.textContent = totalComments;
    totalTimeWorkedElem.textContent = globals.formatTimeMinute(totalMinutesWorked);
  },
  showAnalytics: (item) => {
    elements.analytics.style.display = window.getComputedStyle(elements.analytics).display === "none" ? "flex" : "none";
      const dataId = item.getAttribute("data-id");
      elements.analytics.setAttribute("data-id", dataId);
  
      const project = environment_utils.getProject(dataId);
  
      if (!project) {
        utils.handleError("Project not found");
        return;
      }
    
      const collaboratorsProject = JSON.parse(project.collaborators);
      const collaborator = collaboratorsProject.find(c => c.user_id == globals.getCookie("ID-USER"));
  
      if (!collaborator) {
        utils.handleError("Collaborator not found");
        return;
      }

      utils.updatePerformanceMetrics(collaborator, collaboratorsProject);
      utils.updateWorkMetrics(collaborator, collaboratorsProject);

      const startDate = project.create_date;
      const endDate = new Date().toISOString();

      function createGraphicOfCommits(){
        const commits = collaborator?.commits;
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

        const labels = commits?.map(c => c.date);

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
        const timeWorked = collaborator.time_worked;
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
  formLogin: document.getElementById("form_login"),
  formRegister: document.getElementById("form_signUp"),
  openSetting: document.querySelector("#openSettings"),
  closeSettings: document.querySelectorAll("#closeSetting"),
  userPhoto: document.querySelector("#userPhoto"),
  changeUserPhoto: document.querySelector("#inputfile"),
  template: document.querySelectorAll(".create-template"),
  analytics: document.querySelector("#analytics"),
  imageContainer: document.querySelectorAll('#image-container'),
  imageUpload: document.getElementById('image-upload'),
  themeOptions: document.querySelectorAll(".theme-option"),
  fontSelect: document.querySelector('select[name="Font theme"]'),
  openDesplegableMenuKonva: document.querySelector("#openMenuDesplegableKonva"),
  moreOptionsFilter: document.querySelector("#more-options-filter"),
  moreOptionsRole: document.querySelector("#more-options-role"),
  desplegableMenuKonva:document.querySelector("#desplegableMenuKonva"),
  authCodeContainer: document.querySelector("#authCodeContainer"),
  authCodeClose: document.querySelector("#close-authCode"),
  authCodeVerificate: document.querySelector("#authCodeVerificate"),
  resendCodeAuth: document.querySelector("#resendCodeAuth")
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

  elements.moreOptionsRole?.childNodes.forEach((element) => {
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

  // Metric for projects
  document.querySelectorAll("#metric-project").forEach((item) => {
    item.addEventListener("click", async () => {
      utils.showAnalytics(item);
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
                const datesAndElements = elements.map(el => ({
                    date: el.getAttribute("data-create"),
                    element: el
                }));

                const arrowDate = item.children[1].firstChild.id;

                datesAndElements.sort((a, b) => {
                    if (a.date < b.date) return arrowDate === 'arrowUp' ? -1 : 1;
                    if (a.date > b.date) return arrowDate === 'arrowUp' ? 1 : -1;
                    return 0;
                })

                datesAndElements.forEach(item => {
                    item.element.parentElement.appendChild(item.element);
                });
            break;
          case 2:
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
};

// Initialize
const init = () => {
  addEventListeners();
};

// Run initialization
init();
