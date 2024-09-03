const inputEmail = document.createElement('input');
inputEmail.type = "email";
inputEmail.id = "new-email";
inputEmail.name = "new-email";
inputEmail.className = "w-[50%] opacity-70 bg-[#1E1E1E] text-gray-200 rounded-md px-4 py-2 outline-none mt-1 max-sm:w-full max-sm:text-xs max-sm:mt-2 max-md:w-[70%] max-md:text-[12.9px]";  
inputEmail.placeholder = "Enter your new email";

export function getCloneInputEmail(parent){
    if(parent){
        const inputEmailClone = inputEmail.cloneNode(true);
        parent.appendChild(inputEmailClone);
        return inputEmailClone;
    }
    
    return inputEmail.cloneNode(true);
}