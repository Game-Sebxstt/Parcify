const filter_index = document.querySelectorAll('#filter');

filter_index?.forEach((element, index) => {
    element?.addEventListener("click", () => {
        const more_options_filter = document.querySelectorAll('#more-options-filter')[index];
        const arrow_down_filter = document.querySelectorAll('#arrow-down-filter')[index];
        if(window.getComputedStyle(more_options_filter).display === 'none'){
            more_options_filter.style.display = 'flex';
            arrow_down_filter.style.transform = 'rotate(180deg)';
        }else{
            more_options_filter.style.display = 'none';
            arrow_down_filter.style.transform = 'rotate(0deg)';
        }
    })
})

const items_slide = document.querySelectorAll("#items-slide");

items_slide.forEach((element) => {
    element.addEventListener("click", () => {
        window.location.href = element.getAttribute("data-uri");
    });
})

const menu_header = document.querySelector("#menu-header");

menu_header?.addEventListener("click", () => {
    const slide = document.querySelector("#slideMobile");
    if(window.getComputedStyle(slide).left == "0px"){
        slide.style.left = "-100%"
    }else{
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
    if(window.getComputedStyle(document.getElementById('users-invited')).display == "flex"){
        document.getElementById('users-invited').style.display = 'none'
        document.getElementById('projectContent').style.display = 'flex'
    }
})

const x_close_invite = document.querySelectorAll("#x-close-invite");

x_close_invite?.forEach((element, i) => {
    element.addEventListener("click", () => {
        document.querySelector("#popup-invite").style.display = "none";
        if(i != 0){
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
            if(item != element){
                item.style.backgroundColor = "#595959";
                item.style.borderColor = "transparent";
            }
        });
    });
});

let close_right_slide = document.querySelector("#close-right-slide");
let close_left_slide = document.querySelector("#close-left-slide");

[close_right_slide, close_left_slide].forEach((element) => {
    element.addEventListener("click", () => {
        let class_element = "#" + element.id.split("-")[1] + "-" + element.id.split("-")[2];
        let remove_class = "-" + element.id.split("-")[1] + "-0";
        let add_class = "-" + element.id.split("-")[1] + "-[25rem]";
        let element_id = document.querySelector(class_element)

        if(element_id.classList.contains(remove_class)){
            element_id.classList.replace(remove_class,add_class);
            console.log("a")
            console.log(remove_class, add_class)
        }else{
            element_id.classList.replace(add_class,remove_class);
            console.log(add_class, remove_class)
            console.log("e")
        }
    });
})

let menu_btn = document.querySelectorAll("#menu-btn");

menu_btn.forEach(element => {
    element.addEventListener("click", () => {
        let attr = element.getAttribute("data-section");
        let sections_options = document.querySelectorAll(".section_option");

        sections_options.forEach(element => {
            if(element.id == attr){
                element.style.display = "flex";
            }else{
                element.style.display = "none";
            }
        })      
    });
});

// invite_btn?.addEventListener("click", () => {
//     document.querySelector("#popup-invite").style.display = "flex";
// });