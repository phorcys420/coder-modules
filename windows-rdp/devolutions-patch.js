// @ts-check
/**
 * @file Defines the custom logic for patching in UI changes/behavior into the
 * base Devolutions Gateway Angular app.
 *
 * Defined as a JS file to remove the need to have a separate compilation step.
 * It is highly recommended that you work on this file from within VS Code so
 * that you can take advantage of the @ts-check directive and get some type-
 * checking still.
 *
 * Other notes about the weird ways this file is set up:
 * - A lot of the HTML selectors in this file will look nonstandard. This is
 *   because they are actually custom Angular components.
 * - It is strongly advised that you avoid template literals that use the
 *   placeholder syntax via the dollar sign. The Terraform script looks for
 *   these characters so that it can inject Coder-specific values, so any
 *   template literal that uses the character actually needs to double up each
 *   of them. There are already a few places in this file where it couldn't be
 *   avoided, but it will save you some headache.
 * - All the CSS should be written via custom style tags and the !important
 *   directive (as much as that is a bad idea most of the time). We do not
 *   control the Angular app, so we have to modify things from afar to ensure
 *   that as Angular's internal state changes, it doesn't modify its HTML nodes
 *   in a way that causes our custom styles to get wiped away.
 *
 * @typedef {Readonly<{ querySelector: string; value: string; }>} FormFieldEntry
 * @typedef {Readonly<Record<string, FormFieldEntry>>} FormFieldEntries
 */

/**
 * The communication protocol to set Devolutions to.
 */
const PROTOCOL = "RDP";

/**
 * The hostname to use with Devolutions.
 */
const HOSTNAME = "localhost";

/**
 * How often to poll the screen for the main Devolutions form.
 */
const SCREEN_POLL_INTERVAL_MS = 500;

/**
 * The fields in the Devolutions sign-in form that should be populated with
 * values from the Coder workspace.
 *
 * All properties should be defined as placeholder templates in the form
 * VALUE_NAME. The Coder module, when spun up, should then run some logic to
 * replace the template slots with actual values. These values should never
 * change from within JavaScript itself.
 *
 * @satisfies {FormFieldEntries}
 */
const formFieldEntries = {
  /** @readonly */
  username: {
    /** @readonly */
    querySelector: "web-client-username-control input",

    /** @readonly */
    value: "${CODER_USERNAME}",
  },

  /** @readonly */
  password: {
    /** @readonly */
    querySelector: "web-client-password-control input",

    /** @readonly */
    value: "${CODER_PASSWORD}",
  },
};

/**
 * Handles typing in the values for the input form, dispatching each character
 * as an event. This function assumes that all characters in the input will be
 * UTF-8.
 *
 * Note: this code will never break, but you might get warnings in the console
 * from Angular about unexpected value changes. Angular patches over a lot of
 * the built-in browser APIs to support its component change detection system.
 * As part of that, it has validations for checking whether an input it
 * previously had control over changed without it doing anything.
 *
 * But the only way to simulate a keyboard input is by setting the input's
 * .value property, and then firing an input event. So basically, the inner
 * value will change, which Angular won't be happy about, but then the input
 * event will fire and sync everything back together.
 *
 * @param {HTMLInputElement} inputField
 * @param {string} inputText
 * @returns {Promise<void>}
 */
function setInputValue(inputField, inputText) {
  const continueEventName = "coder-patch--continue";

  const keyboardInputPromise = /** @type {Promise<void>} */ (
    new Promise((resolve, reject) => {
      if (inputText === "") {
        resolve();
        return;
      }

      // -1 indicates a "pre-write" for clearing out the input before trying to
      // write new text to it
      let i = -1;

      // requestAnimationFrame is not capable of giving back values of 0 for its
      // task IDs. Good default value to ensure that we don't need if statements
      // when trying to cancel anything
      let currentAnimationId = 0;

      // Super easy to pool the same event objects, because the events don't
      // have any custom, context-specific values on them, and they're
      // restricted to this one callback.
      const continueEvent = new CustomEvent(continueEventName);
      const inputEvent = new Event("input", {
        bubbles: true,
        cancelable: true,
      });

      /** @returns {void} */
      const handleNextCharIndex = () => {
        if (i === inputText.length) {
          resolve();
          return;
        }

        const currentChar = inputText[i];
        if (i !== -1 && currentChar === undefined) {
          throw new Error("Went out of bounds");
        }

        try {
          inputField.addEventListener(
            continueEventName,
            () => {
              i++;
              currentAnimationId =
                window.requestAnimationFrame(handleNextCharIndex);
            },
            { once: true },
          );

          if (i === -1) {
            inputField.value = "";
          } else {
            inputField.value = inputField.value + currentChar;
          }

          inputField.dispatchEvent(inputEvent);
          inputField.dispatchEvent(continueEvent);
        } catch (err) {
          cancelAnimationFrame(currentAnimationId);
          reject(err);
        }
      };

      currentAnimationId = window.requestAnimationFrame(handleNextCharIndex);
    })
  );

  return keyboardInputPromise;
}

/**
 * Takes a Devolutions remote session form, auto-fills it with data, and then
 * submits it.
 *
 * The logic here is more convoluted than it should be for two main reasons:
 * 1. Devolutions' HTML markup has errors. There are labels, but they aren't
 *    bound to the inputs they're supposed to describe. This means no easy hooks
 *    for selecting the elements, unfortunately.
 * 2. Trying to modify the .value properties on some of the inputs doesn't
 *    work. Probably some combo of Angular data-binding and some inputs having
 *    the readonly attribute. Have to simulate user input to get around this.
 *
 * @param {HTMLFormElement} myForm
 * @returns {Promise<void>}
 */
async function autoSubmitForm(myForm) {
  const setProtocolValue = () => {
    /** @type {HTMLDivElement | null} */
    const protocolDropdownTrigger = myForm.querySelector('div[role="button"]');
    if (protocolDropdownTrigger === null) {
      throw new Error("No clickable trigger for setting protocol value");
    }

    protocolDropdownTrigger.click();

    // Can't use form as container for querying the list of dropdown options,
    // because the elements don't actually exist inside the form. They're placed
    // in the top level of the HTML doc, and repositioned to make it look like
    // they're part of the form. Avoids CSS stacking context issues, maybe?
    /** @type {HTMLLIElement | null} */
    const protocolOption = document.querySelector(
      'p-dropdownitem[ng-reflect-label="' + PROTOCOL + '"] li',
    );

    if (protocolOption === null) {
      throw new Error(
        "Unable to find protocol option on screen that matches desired protocol",
      );
    }

    protocolOption.click();
  };

  const setHostname = () => {
    /** @type {HTMLInputElement | null} */
    const hostnameInput = myForm.querySelector("p-autocomplete#hostname input");

    if (hostnameInput === null) {
      throw new Error("Unable to find field for adding hostname");
    }

    return setInputValue(hostnameInput, HOSTNAME);
  };

  const setCoderFormFieldValues = async () => {
    // The RDP form will not appear on screen unless the dropdown is set to use
    // the RDP protocol
    const rdpSubsection = myForm.querySelector("rdp-form");
    if (rdpSubsection === null) {
      throw new Error(
        "Unable to find RDP subsection. Is the value of the protocol set to RDP?",
      );
    }

    for (const { value, querySelector } of Object.values(formFieldEntries)) {
      /** @type {HTMLInputElement | null} */
      const input = document.querySelector(querySelector);

      if (input === null) {
        throw new Error(
          'Unable to element that matches query "' + querySelector + '"',
        );
      }

      await setInputValue(input, value);
    }
  };

  const triggerSubmission = () => {
    /** @type {HTMLButtonElement | null} */
    const submitButton = myForm.querySelector(
      'p-button[ng-reflect-type="submit"] button',
    );

    if (submitButton === null) {
      throw new Error("Unable to find submission button");
    }

    if (submitButton.disabled) {
      throw new Error(
        "Unable to submit form because submit button is disabled. Are all fields filled out correctly?",
      );
    }

    submitButton.click();
  };

  setProtocolValue();
  await setHostname();
  await setCoderFormFieldValues();
  triggerSubmission();
}

/**
 * Sets up logic for auto-populating the form data when the form appears on
 * screen.
 *
 * @returns {void}
 */
function setupFormDetection() {
  /** @type {HTMLFormElement | null} */
  let formValueFromLastMutation = null;

  /** @returns {void} */
  const onDynamicTabMutation = () => {
    /** @type {HTMLFormElement | null} */
    const latestForm = document.querySelector("web-client-form > form");

    if (latestForm === null) {
      formValueFromLastMutation = null;
      return;
    }

    // Only try to auto-fill if we went from having no form on screen to
    // having a form on screen. That way, we don't accidentally override the
    // form if the user is trying to customize values, and this essentially
    // makes the script values function as default values
    if (formValueFromLastMutation === null) {
      autoSubmitForm(latestForm);
    }

    formValueFromLastMutation = latestForm;
  };

  /** @type {number | undefined} */
  let pollingId = undefined;

  /** @returns {void} */
  const checkScreenForDynamicTab = () => {
    const dynamicTab = document.querySelector("web-client-dynamic-tab");

    // Keep polling until the main content container is on screen
    if (dynamicTab === null) {
      return;
    }

    window.clearInterval(pollingId);

    // Call the mutation callback manually, to ensure it runs at least once
    onDynamicTabMutation();

    // Having the mutation observer is kind of an extra safety net that isn't
    // really expected to run that often. Most of the content in the dynamic
    // tab is being rendered through Canvas, which won't trigger any mutations
    // that the observer can detect
    const dynamicTabObserver = new MutationObserver(onDynamicTabMutation);
    dynamicTabObserver.observe(dynamicTab, {
      subtree: true,
      childList: true,
    });
  };

  pollingId = window.setInterval(
    checkScreenForDynamicTab,
    SCREEN_POLL_INTERVAL_MS,
  );
}

/**
 * Sets up custom styles for hiding default Devolutions elements that Coder
 * users shouldn't need to care about.
 *
 * @returns {void}
 */
function setupAlwaysOnStyles() {
  const styleId = "coder-patch--styles-always-on";
  const existingContainer = document.querySelector("#" + styleId);
  if (existingContainer) {
    return;
  }

  const styleContainer = document.createElement("style");
  styleContainer.id = styleId;
  styleContainer.innerHTML = `
    /* app-menu corresponds to the sidebar of the default view. */
    app-menu {
      display: none !important;
    }
  `;

  document.head.appendChild(styleContainer);
}

function hideFormForInitialSubmission() {
  const styleId = "coder-patch--styles-initial-submission";
  const opacityVariableName = "--coder-opacity-multiplier";

  /** @type {HTMLStyleElement | null} */
  let styleContainer = document.querySelector("#" + styleId);
  if (!styleContainer) {
    styleContainer = document.createElement("style");
    styleContainer.id = styleId;
    styleContainer.innerHTML = `
      /*
        Have to use opacity instead of visibility, because the element still
        needs to be interactive via the script so that it can be auto-filled.
      */
      :root {
        /*
          Can be 0 or 1. Start off invisible to avoid risks of UI flickering,
          but the rest of the function should be in charge of making the form
          container visible again if something goes wrong during setup.
        */
        $${opacityVariableName}: 0;
      }

      /* web-client-form is the container for the main session form */
      web-client-form {
        opacity: calc(100% * var($${opacityVariableName})) !important;
      }
    `;

    document.head.appendChild(styleContainer);
  }

  // The root node being undefined should be physically impossible (if it's
  // undefined, the browser itself is busted), but we need to do a type check
  // here so that the rest of the function doesn't need to do type checks over
  // and over.
  const rootNode = document.querySelector(":root");
  if (!(rootNode instanceof HTMLHtmlElement)) {
    styleContainer.innerHTML = "";
    return;
  }

  // It's safe to make the form visible preemptively because Devolutions
  // outputs the Windows view through an HTML canvas that it overlays on top
  // of the rest of the app. Even if the form isn't hidden at the style level,
  // it will still be covered up.
  const restoreOpacity = () => {
    rootNode.style.setProperty(opacityVariableName, "1");
  };

  /** @type {number | undefined} */
  let intervalId = undefined;
  const pollingTimeoutMs = 5_000;
  let pollAttempts = 0;

  const checkIfSafeToHideForm = () => {
    /** @type {HTMLFormElement | null} */
    const form = document.querySelector("web-client-form > form");
    if (form === null) {
      pollAttempts++;
      const elapsedTime = pollAttempts * SCREEN_POLL_INTERVAL_MS;

      if (elapsedTime >= pollingTimeoutMs) {
        restoreOpacity();
        window.clearInterval(intervalId);
      }

      return;
    }

    // If this file gets more complicated, it might make sense to set up the
    // timeout and event listener so that if one triggers, it cancels the other,
    // but having restoreOpacity run more than once is a no-op for right now.
    // Not a big deal if these don't get cleaned up.
    window.setTimeout(restoreOpacity, 5_000);
    form.addEventListener("submit", restoreOpacity, { once: true });
  };

  intervalId = window.setInterval(
    checkIfSafeToHideForm,
    SCREEN_POLL_INTERVAL_MS,
  );
}

function setupFormOverrides() {
  hideFormForInitialSubmission();
  setupFormDetection();
}

// Always safe to call this immediately because even if the Angular app isn't
// loaded by the time the function gets called, the CSS will always be globally
// available for when Angular is finally ready
setupAlwaysOnStyles();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupFormOverrides);
} else {
  setupFormOverrides();
}
