/** localStorage key for the hide-amounts switch ("1" = hidden). Plain module so the server layout can inline the boot script. */
export const PRIVACY_KEY = "headroom:privacy";

/**
 * Runs inline in <head> before the first paint: stamps `data-privacy="hidden"` on <html> so the
 * CSS that masks amounts applies to the server-rendered page without a flash of numbers.
 */
export const PRIVACY_BOOT_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(PRIVACY_KEY)})==="1")document.documentElement.setAttribute("data-privacy","hidden")}catch(e){}`;
