import React,{ useState, useEffect } from "react";
import { generateID } from "../../../js/globals/astro-utils.js";
import * as environment_utils from "../../../js/globals/environment-utils";
import ArticleIndex from "./ArticleIndex.jsx";
import ArticlePlus from "./ArticlePlus.jsx";
import useAppState from "../hooks/useAppState.js";

export default function ProjectsIndex() {
    const user_id = environment_utils.getDataUser().users.user_id;
    const { projects, ProjectsUpdate } = useAppState();

    const sortByName = (projects, order) => {
        return [...projects].sort((a, b) => {
            const nameA = a.name.toLowerCase();
            const nameB = b.name.toLowerCase();
            return order === 'arrowDown' ? (nameA > nameB ? 1 : -1) : (nameA < nameB ? 1 : -1);
        });
    };

    const sortByDate = (projects, order) => {
        return [...projects].sort((a, b) => {
            const dateA = new Date(a.last_modified);
            const dateB = new Date(b.last_modified);
            return order === 'arrowDown' ? (dateA > dateB ? 1 : -1) : (dateA < dateB ? 1 : -1);
        });
    };

    const handleFilter = (index, arrow) => {
        let updatedProjects = [...environment_utils.getProjects().filter(project => project.user_id == user_id), ...environment_utils.getProjectsShared()];

        switch (index) {
            case 0:
                updatedProjects = sortByName(updatedProjects, arrow);
                break;
            case 1:
                updatedProjects = sortByDate(updatedProjects, arrow);
                break;
            case 2:
                updatedProjects = environment_utils.getProjectsShared();
                break;
            case 3:
                updatedProjects = [...environment_utils.getProjects().filter(project => project.user_id === user_id), ...environment_utils.getProjectsShared()];
                break;
            default:
                console.error("Error al filtrar");
                return;
        }

        ProjectsUpdate(updatedProjects);
    };

    useEffect(() => {
        document.querySelectorAll("#filtro").forEach((item, index) => {
            item.addEventListener("click", () => {
                let arrow = item.children[1];
                if(arrow){
                    arrow = arrow.firstChild.id
                }
                handleFilter(index, arrow);
            });
        });
    }, []);

    return (
        <div id="content-grid" className="w-full grid grid-cols-3 max-xl:grid-cols-2 max-[980px]:grid-cols-1 gap-5 gap-y-10 overflow-hidden">
            <ArticlePlus/>
            {
                projects.map((item) => (
                    <ArticleIndex 
                        key={item.project_id}
                        id="project" 
                        name={item.name}
                        id_element={generateID()}
                        project_id={item.project_id} 
                        preview={item.preview} 
                        last_modified={item.last_modified} 
                    />
                ))
            }
        </div>
    );
}
