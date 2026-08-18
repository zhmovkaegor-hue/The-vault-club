/* Фирменная тема Tailwind. Подключать СТРОГО после cdn.tailwindcss.com.
   Общая для index.html, success.html, fail.html, privacy.html, offer.html —
   новые цвета сюда не добавлять без необходимости. */
tailwind.config = {
    theme: {
        extend: {
            colors: {
                vault: {
                    bg: '#FDFBF7',      // Кремовый фон из макета
                    accent: '#D85427',  // Терракотовый/оранжевый акцент
                    text: '#2A2626',    // Темный цвет для основного текста
                    line: '#EAE3DB',    // Цвет тонких разделительных линий
                }
            },
            fontFamily: {
                serif: ['"Playfair Display"', 'serif'],
                sans: ['Inter', 'sans-serif'],
            },
            spacing: {
                '18': '4.5rem',
                '22': '5.5rem',
                '30': '7.5rem',
            },
            transitionTimingFunction: {
                'premium': 'cubic-bezier(0.25, 1, 0.5, 1)',
            }
        }
    }
}
