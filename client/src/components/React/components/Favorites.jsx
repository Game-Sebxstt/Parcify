import React from 'react';
import useAppState from '../hooks/useAppState';

const Favorites = () => {
    const { favorites } = useAppState();

    const showMoreFavorites = () => {
        const moreFavorites = document.querySelector("#moreFavorites");
        moreFavorites.style.display = "flex";
    }

    const svgIcons = {
        project: (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="grey" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon icon-tabler icon-tabler-brush">
            <path stroke="none" d="M0 0h24v24H0z" fill="none" />
            <path d="M3 21v-4a4 4 0 1 1 4 4h-4" />
            <path d="M21 3a16 16 0 0 0 -12.8 10.2" />
            <path d="M21 3a16 16 0 0 1 -10.2 12.8" />
            <path d="M10.6 9a9 9 0 0 1 4.4 4.4" />
        </svg>
        ),
        template: (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="grey" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon icon-tabler icon-tabler-template">
            <path stroke="none" d="M0 0h24v24H0z" fill="none" />
            <path d="M4 4m0 1a1 1 0 0 1 1 -1h14a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-14a1 1 0 0 1 -1 -1z" />
            <path d="M4 12m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" />
            <path d="M14 12l6 0" />
            <path d="M14 16l6 0" />
            <path d="M14 20l6 0" />
        </svg>
        ),
    };

    return (
        <article className="flex flex-col">
        <h3 className="text-lg text-white pt-3 px-5">Favorites</h3>
        <div className="py-4 px-6 text-white font-semibold flex flex-col gap-4">
            <div id="content-favorites" className="flex flex-col gap-4">
            {favorites.length === 0 ? (
                <p className="text-white/30 font-normal">You don't have any favorites, add one!!</p>
            ) : (
                favorites.slice(0, 6).map((favorite, index) => (
                    <div
                        key={index}
                        id="useFavorite"
                        className="gap-3 p-2 rounded flex items-center cursor-pointer active:bg-stone-950"
                    >
                        <i id="typeDescription" className="group">
                            {favorite.type === 'project' ? svgIcons.project : svgIcons.template}
                        </i>
                        <p>{favorite.name}</p>
                    </div>
                ))
            )}
            </div>
            {favorites.length > 6 && (
                <p id="showMoreFavorites" onClick={showMoreFavorites} className="hover:underline cursor-pointer font-normal text-sky-400">
                    Ver más...
                </p>
            )}
        </div>
        </article>
    );
};

export default Favorites;