import React, { useEffect, useState } from 'react';
import TemplateView from '../components/TemplateView';
import Article from '../components/ArticleIndex';
import * as astro_utils from '../../../js/globals/astro-utils';
import useAppState from '../hooks/useAppState';

const MoreFavorites = () => {
  const { favorites } = useAppState();

  const closeTemplate = () => {
    const template = document.getElementById('moreFavorites');
    if (template) {
      template.style.display = "none"
    }
  };

  return (
    <section id="moreFavorites" className="fixed w-full h-full z-40 hidden justify-center items-center bg-black/80">
      <section className="max-w-4xl w-full h-[95%] bg-[#2c2c2c] rounded-md p-3 flex flex-col gap-2 animate-deployment">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <img src="/Logo-no-background-no-text.png" className="h-10" alt="Logo" />
            <h3 className="text-xl font-bold text-white">Parcify</h3>
          </div>
          <button
            id="close-button"
            type="button"
            className="text-gray-400 hover:bg-gray-200 hover:text-gray-900 rounded-lg w-8 h-8 inline-flex justify-center items-center"
            onClick={closeTemplate}
          >
            <svg className="w-3 h-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 14 14" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m1 1 6 6m0 0 6 6M7 7l6-6M7 7l-6 6" />
            </svg>
          </button>
        </header>

        <hr className="border-blue-500" />

        <main id="content-more-favorites" className="h-full p-2 grid grid-cols-2 gap-5 overflow-auto">
          {favorites.length > 0 ? (
            favorites.map((element) =>
              element.template_id ? (
                <TemplateView
                  key={element.template_id}
                  id="templateFavorites"
                  first_text={element.name}
                  second_text={element.autor}
                  url_image={element.preview}
                  template_id={element.template_id}
                  description={element.description}
                  likes={element.likes}
                />
              ) : (
                <Article
                  key={element.project_id}
                  id="project"
                  id_element={astro_utils.generateID()}
                  name={element.name}
                  last_modified={element.last_modified}
                  project_id={element.project_id}
                  preview={element.preview}
                />
              )
            )
          ) : (
            <span>Dont have any favorite</span>
          )}
        </main>
      </section>
    </section>
  );
};

export default MoreFavorites;
