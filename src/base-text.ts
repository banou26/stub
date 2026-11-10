import { css } from '@emotion/react'

/**
 * stub's typeface and text color, for each document stub draws: the app (src/index.tsx) and the player page
 * (src/embed.tsx), which inherits nothing from the page framing it. A global style, as `<Global styles={baseText}/>`.
 * The app's 62.5% root size stays in the app: the player page keeps the browser's 16px, which the videojs skin's
 * sizes and container queries are written in.
 */
export const baseText = css`
  @import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@300;400;500;600;700&family=Fira+Sans:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,500;1,600;1,700;1,800;1,900&family=Montserrat:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&family=Roboto:ital,wght@0,100;0,300;0,400;0,500;0,700;0,900;1,100;1,300;1,400;1,500;1,700;1,900&display=swap');

  body {
    color: #fff;
    /* Montserrat draws Latin, Cyrillic and Vietnamese; every other script falls to the system's own sans-serif */
    font-family: Montserrat, system-ui, sans-serif;
  }
`
