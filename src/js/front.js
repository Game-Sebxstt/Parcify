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
            if(element.id == attr){
                element.style.display = "flex";

                if(attr == "section_folders"){
                    document.querySelector("#header-one").style.display = "none";
                    document.querySelector("#header-two").style.display = "flex";
                }else{
                    document.querySelector("#header-one").style.display = "flex";
                    document.querySelector("#header-two").style.display = "none";
                }

            }else{
                element.style.display = "none";
            }
        })      
    });
});

// invite_btn?.addEventListener("click", () => {
//     document.querySelector("#popup-invite").style.display = "flex";
// });