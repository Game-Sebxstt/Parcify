// useAppState.js
import { useEffect } from 'react';
import { create } from 'zustand';
import * as environment_utils from '../../../js/globals/environment-utils';

function createFavorites(user_id) {
    let isData = environment_utils.getPreferences();
    let dataFilter = [];
    let numFavorites = [];

    if (isData) {
        const projects = environment_utils.getProjects().filter(project => project.user_id === user_id);
        const templates = environment_utils.getTemplates();
        const elementsUser = [...projects, ...templates];

        isData.forEach((item) => {
            elementsUser.forEach((element) => {
                if (item.id === element.project_id || item.id === element.template_id) {
                    element["type"] = item.type;
                    dataFilter.push(element);
                }
            });
        });

        numFavorites = isData;
    }

    return { dataFilter, numFavorites };
}

const useGlobalStore = create((set) => {
    const user_id = environment_utils.getDataUser().users.user_id;

    return {
        projects: [
            ...environment_utils.getProjects().filter(project => project.user_id === user_id),
            ...environment_utils.getProjectsShared()
        ],
        templates: environment_utils.getTemplates(),
        favorites: createFavorites(user_id).dataFilter,
        numFavorites: createFavorites(user_id).numFavorites,
        tittle: '',
        description: '',
        author: '',
        preview: '',
        template_id: '',
        isVisibleCreateParceller: false,
        ProjectsUpdate: (projects) => set({ projects }),
        TemplatesUpdate: (templates) => set({ templates }),
        FavoritesUpdate: (favorites) => set({ favorites }),
        NumFavoritesUpdate: (numFavorites) => set({ numFavorites }),
        TittleUpdate: (tittle) => set({ tittle }),
        DescriptionUpdate: (description) => set({ description }),
        AuthorUpdate: (author) => set({ author }),
        PreviewUpdate: (preview) => set({ preview }),
        TemplateIdUpdate: (template_id) => set({ template_id }),
        IsVisibleCreateParcellerUpdate: (isVisibleCreateParceller) => set({ isVisibleCreateParceller })
    };
});

const useAppState = () => {
    const state = useGlobalStore();

    return {
        projects: state.projects,
        ProjectsUpdate: state.ProjectsUpdate,
        templates: state.templates,
        TemplatesUpdate: state.TemplatesUpdate,
        favorites: state.favorites,
        FavoritesUpdate: state.FavoritesUpdate,
        numFavorites: state.numFavorites,
        NumFavoritesUpdate: state.NumFavoritesUpdate,
        tittle: state.tittle,
        TittleUpdate: state.TittleUpdate,
        description: state.description,
        DescriptionUpdate: state.DescriptionUpdate,
        author: state.author,
        AuthorUpdate: state.AuthorUpdate,
        preview: state.preview,
        PreviewUpdate: state.PreviewUpdate,
        template_id: state.template_id,
        TemplateIdUpdate: state.TemplateIdUpdate,
        isVisibleCreateParceller: state.isVisibleCreateParceller,
        IsVisibleCreateParcellerUpdate: state.IsVisibleCreateParcellerUpdate,
    };
};

export default useAppState;