import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import "./Ipaload.css";
import "./Studio.css";
import { AppleID } from "./AppleID";
import { Device, DeviceInfo } from "./Device";
import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  sideloadOperation,
  installSideStoreOperation,
  installLiveContainerOperation,
  Operation,
  OperationState,
  OperationUpdate,
} from "./components/operations";
import { listen } from "@tauri-apps/api/event";
import OperationView from "./components/OperationView";
import { toast } from "sonner";
import { Modal } from "./components/Modal";
import { Certificates } from "./pages/Certificates";
import { AppIds } from "./pages/AppIds";
import { Settings } from "./pages/Settings";
import { Pairing } from "./pages/Pairing";
import { getVersion } from "@tauri-apps/api/app";
import logo from "./download.svg";
import { GlassCard } from "./components/GlassCard";
import { useTranslation } from "react-i18next";
import { usePlatform } from "./PlatformContext";
import { useStore } from "./StoreContext";
import i18n from "./i18next";

function App() {
  const { t } = useTranslation();
  const [language, setLanguage] = useStore<string>("lang", "ru");
  const [tourStep, setTourStep] = useState(0);
  const [tourOpen, setTourOpen] = useState(
    () => localStorage.getItem("ipaload-tour-complete") !== "true",
  );

  const [operationState, setOperationState] = useState<OperationState | null>(
    null,
  );
  const [loggedInAs, setLoggedInAs] = useState<string | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<DeviceInfo | null>(null);
  const [openModal, setOpenModal] = useState<
    null | "certificates" | "appids" | "pairing"
  >(null);
  const [version, setVersion] = useState<string>("");

  const refreshDevicesRef = useRef<(() => void) | null>(null);

  const [noKeyringAvailable, setNoKeyringAvailable] = useState<boolean>(false);
  const { platform } = usePlatform();

  useEffect(() => {
    const supportedLanguage = language === "en" ? "en" : "ru";
    document.documentElement.lang = supportedLanguage;
    if (language !== supportedLanguage) {
      setLanguage(supportedLanguage);
    } else if (supportedLanguage !== i18n.resolvedLanguage) {
      void i18n.changeLanguage(supportedLanguage);
    }
  }, [language, setLanguage]);

  const checkKeyring = useCallback(async () => {
    try {
      let available = await invoke<boolean>("keyring_available");
      setNoKeyringAvailable(!available);
    } catch (e) {
      console.error("Unable to check keyring availability:", e);
      setNoKeyringAvailable(true);
    }
  }, []);

  useEffect(() => {
    checkKeyring();
  }, [checkKeyring]);

  useEffect(() => {
    const fetchVersion = async () => {
      const version = await getVersion();
      setVersion(version);
    };
    fetchVersion();
  }, []);

  const shortcutLabel = useCallback(
    (mac: string, windows: string, linux?: string) => {
      if (platform === "mac") return mac;
      if (platform === "linux") return linux ?? windows;
      return windows;
    },
    [platform],
  );

  const closeTour = useCallback(() => {
    localStorage.setItem("ipaload-tour-complete", "true");
    setTourOpen(false);
  }, []);

  const openTour = useCallback(() => {
    setTourStep(0);
    setTourOpen(true);
  }, []);

  useEffect(() => {
    if (!tourOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeTour();
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [closeTour, tourOpen]);

  const startOperation = useCallback(
    async (
      operation: Operation,
      params: { [key: string]: any },
    ): Promise<void> => {
      setOperationState({
        current: operation,
        started: [],
        failed: [],
        completed: [],
      });
      return new Promise<void>(async (resolve, reject) => {
        const unlistenFn = await listen<OperationUpdate>(
          "operation_" + operation.id,
          (event) => {
            setOperationState((old) => {
              if (old == null) return null;
              if (event.payload.updateType === "started") {
                return {
                  ...old,
                  started: [...old.started, event.payload.stepId],
                };
              } else if (event.payload.updateType === "finished") {
                return {
                  ...old,
                  completed: [...old.completed, event.payload.stepId],
                };
              } else if (event.payload.updateType === "failed") {
                return {
                  ...old,
                  failed: [
                    ...old.failed,
                    {
                      stepId: event.payload.stepId,
                      extraDetails: event.payload.extraDetails,
                    },
                  ],
                };
              }
              return old;
            });
          },
        );
        try {
          await invoke(operation.id + "_operation", params);
          unlistenFn();
          resolve();
        } catch (e) {
          unlistenFn();
          reject(e);
        }
      });
    },
    [setOperationState],
  );

  const ensuredLoggedIn = useCallback((): boolean => {
    if (loggedInAs) return true;
    toast.error(t("app.must_be_logged_in"));
    return false;
  }, [loggedInAs, t]);

  const ensureSelectedDevice = useCallback((): boolean => {
    if (selectedDevice) return true;
    toast.error(t("app.must_select_device"));
    return false;
  }, [selectedDevice, t]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === undefined) return;
      const key = event.key.toLowerCase();
      const primaryPressed = platform === "mac" ? event.metaKey : event.ctrlKey;
      if (!primaryPressed) return;

      if (!event.shiftKey && key === "p") {
        event.preventDefault();
        if (!ensureSelectedDevice()) return;
        setOpenModal("pairing");
      } else if (event.shiftKey && key === "c") {
        event.preventDefault();
        if (!ensuredLoggedIn()) return;
        setOpenModal("certificates");
      } else if (event.shiftKey && key === "a") {
        event.preventDefault();
        if (!ensuredLoggedIn()) return;
        setOpenModal("appids");
      } else if (!event.shiftKey && key === "r") {
        event.preventDefault();
        refreshDevicesRef.current?.();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [platform, ensureSelectedDevice, ensuredLoggedIn]);

  return (
    <main className="workspace">
      <header className="workspace-header">
        <div className="header-left">
          <div className="title-block" data-tauri-drag-region>
            <img src={logo} alt={t("app.logo_alt")} className="logo" />
            <div>
              <h1 className="title">ipaload</h1>
              <p className="subtitle">{t("app.tagline")}</p>
            </div>
          </div>
        </div>
        <div className="header-actions">
          <span className="version-pill">
            <span className="status-indicator" />
            {t("version")} {version}
          </span>
          <label className="language-control">
            <span className="sr-only">{t("app.language")}</span>
            <select
              className="language-switch"
              value={language === "en" ? "en" : "ru"}
              onChange={(event) => setLanguage(event.target.value)}
              aria-label={t("app.language")}
            >
              <option value="ru">{t("app.language_ru")}</option>
              <option value="en">{t("app.language_en")}</option>
            </select>
          </label>
          <button
            className="toolbar-button guide-button"
            onClick={openTour}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" />
              <path d="M9.6 9a2.5 2.5 0 0 1 4.8.8c0 1.7-2.4 2-2.4 3.8M12 17.2v.1" />
            </svg>
            {t("app.tour")}
          </button>
          <button
            className="toolbar-button faq-button"
            onClick={() =>
              document
                .getElementById("faq-section")
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            {t("app.faq")}
          </button>
        </div>
      </header>
      <div className="workspace-body">
        <aside className="workspace-sidebar">
          <section className="workspace-section">
            <div className="section-header">
              <p className="section-label">{t("app.section_account")}</p>
              {/* here to ensure spacing and stuff is correct */}
              <span className="section-hint placeholder" aria-hidden="true">
                Placeholder
              </span>
            </div>
            <GlassCard className="panel">
              <AppleID
                loggedInAs={loggedInAs}
                setLoggedInAs={setLoggedInAs}
                noKeyringAvailable={noKeyringAvailable}
              />
            </GlassCard>
          </section>
          <section className="workspace-section">
            <p className="section-label">{t("app.section_management")}</p>
            <div className="workspace-list">
              <button
                className="workspace-list-item"
                onClick={() => {
                  if (!ensureSelectedDevice()) return;
                  setOpenModal("pairing");
                }}
              >
                {t("app.manage_pairing_file")}{" "}
                <span aria-hidden="true">{shortcutLabel("⌘P", "Ctrl+P")}</span>
              </button>
              <button
                className="workspace-list-item"
                onClick={() => {
                  refreshDevicesRef.current?.();
                }}
              >
                {t("app.refresh_devices")}{" "}
                <span aria-hidden="true">{shortcutLabel("⌘R", "Ctrl+R")}</span>
              </button>
              <button
                className="workspace-list-item"
                onClick={() => {
                  if (!ensuredLoggedIn()) return;
                  setOpenModal("certificates");
                }}
              >
                {t("app.certificates")}{" "}
                <span aria-hidden="true">
                  {shortcutLabel("⌘⇧C", "Ctrl+Shift+C")}
                </span>
              </button>
              <button
                className="workspace-list-item"
                onClick={() => {
                  if (!ensuredLoggedIn()) return;
                  setOpenModal("appids");
                }}
              >
                {t("app.app_ids")}{" "}
                <span aria-hidden="true">
                  {shortcutLabel("⌘⇧A", "Ctrl+Shift+A")}
                </span>
              </button>
            </div>
          </section>
        </aside>
        <section className="workspace-content">
          <section className="welcome-panel" aria-labelledby="welcome-title">
            <div className="welcome-copy">
              <p className="welcome-eyebrow">{t("app.workspace_eyebrow")}</p>
              <h2 id="welcome-title">{t("app.workspace_title")}</h2>
              <p className="welcome-description">
                {t("app.workspace_description")}
              </p>
              <button className="welcome-guide" onClick={openTour}>
                {t("app.welcome_guide")}
                <span aria-hidden="true">↗</span>
              </button>
            </div>
            <div className="welcome-steps" aria-label={t("app.tour")}>
              <div className="welcome-device-art" aria-hidden="true">
                <span className="device-art-glow" />
                <svg viewBox="0 0 92 92" fill="none">
                  <rect x="19" y="9" width="54" height="74" rx="15" />
                  <path d="M39 69h14" />
                  <path d="M46 28v22m0 0 9-9m-9 9-9-9M35 55v3a5 5 0 0 0 5 5h12a5 5 0 0 0 5-5v-3" />
                </svg>
                <span className="device-art-caption">01 / 03</span>
              </div>
              <span className="welcome-step welcome-step-one">
                <span>01</span>
                {t("app.tour_connect")}
              </span>
              <span className="welcome-step welcome-step-two">
                <span>02</span>
                {t("app.tour_title_2")}
              </span>
              <span className="welcome-step welcome-step-three">
                <span>03</span>
                {t("app.tour_title_4")}
              </span>
            </div>
            <span className="welcome-decoration welcome-decoration-one" />
            <span className="welcome-decoration welcome-decoration-two" />
          </section>
          <section className="workspace-section">
            <div className="section-header">
              <p className="section-label">{t("app.devices")}</p>
              <span className="section-hint">
                {selectedDevice
                  ? t("app.active_device", {
                      name: `${selectedDevice.name} (${selectedDevice.version})`,
                    })
                  : t("app.select_device")}
              </span>
            </div>
            <GlassCard className="panel">
              <Device
                selectedDevice={selectedDevice}
                setSelectedDevice={setSelectedDevice}
                registerRefresh={(fn) => {
                  refreshDevicesRef.current = fn ?? null;
                }}
              />
            </GlassCard>
          </section>
          <section className="workspace-section">
            <div className="section-header">
              <p className="section-label">{t("app.installers")}</p>
              <span className="section-hint">{t("app.choose_build")}</span>
            </div>
            <GlassCard className="panel">
              <div className="action-row single-row">
                <button
                  onClick={() => {
                    if (!ensuredLoggedIn() || !ensureSelectedDevice()) return;
                    startOperation(installSideStoreOperation, {
                      nightly: false,
                      liveContainer: false,
                    }).catch((e) => {
                      console.log(e.type);
                      console.error(e.message);
                    });
                  }}
                >
                  {t("app.sidestore_stable")}
                </button>
                <button
                  onClick={() => {
                    if (!ensuredLoggedIn() || !ensureSelectedDevice()) return;
                    startOperation(installSideStoreOperation, {
                      nightly: true,
                      liveContainer: false,
                    }).catch((e) => {
                      console.log(e.type);
                      console.error(e.message);
                    });
                  }}
                >
                  {t("app.sidestore_nightly")}
                </button>
                <button
                  onClick={() => {
                    if (!ensuredLoggedIn() || !ensureSelectedDevice()) return;
                    startOperation(installLiveContainerOperation, {
                      nightly: false,
                      liveContainer: true,
                    }).catch((e) => {
                      console.log(e.type);
                      console.error(e.message);
                    });
                  }}
                >
                  {t("app.livecontainer_sidestore_stable")}
                </button>
                <button
                  onClick={() => {
                    if (!ensuredLoggedIn() || !ensureSelectedDevice()) return;
                    startOperation(installLiveContainerOperation, {
                      nightly: true,
                      liveContainer: true,
                    }).catch((e) => {
                      console.log(e.type);
                      console.error(e.message);
                    });
                  }}
                >
                  {t("app.livecontainer_sidestore_nightly")}
                </button>
                <button
                  onClick={async () => {
                    if (!ensuredLoggedIn() || !ensureSelectedDevice()) return;
                    let path = await openFileDialog({
                      multiple: false,
                      filters: [
                        { name: t("app.ipa_files"), extensions: ["ipa"] },
                      ],
                    });
                    if (!path) return;
                    startOperation(sideloadOperation, {
                      appPath: path as string,
                    }).catch((e) => {
                      console.log(e.type);
                      console.error(e.message);
                    });
                  }}
                >
                  {t("app.import_ipa")}
                </button>
              </div>
            </GlassCard>
          </section>
          <section className="workspace-section">
            <p className="section-label">{t("app.settings")}</p>
            <GlassCard className="panel settings-panel">
              <Settings
                ensureSelectedDevice={ensureSelectedDevice}
                setSelectedDevice={setSelectedDevice}
                platform={platform}
                shortcutLabel={shortcutLabel}
                checkKeyring={checkKeyring}
              />
            </GlassCard>
          </section>
          <section
            className="workspace-section faq-section"
            id="faq-section"
            aria-labelledby="faq-title"
          >
            <div className="faq-heading">
              <div>
                <p className="section-label">{t("app.faq_eyebrow")}</p>
                <h2 id="faq-title">{t("app.faq_title")}</h2>
              </div>
              <p>{t("app.faq_description")}</p>
            </div>
            <div className="faq-list">
              {Array.from({ length: 8 }, (_, index) => index + 1).map(
                (item) => (
                  <details className="faq-item" key={item}>
                    <summary>
                      <span>{t(`app.faq_question_${item}`)}</span>
                      <span className="faq-toggle" aria-hidden="true">
                        +
                      </span>
                    </summary>
                    <p>{t(`app.faq_answer_${item}`)}</p>
                  </details>
                ),
              )}
            </div>
          </section>
          {operationState && (
            <OperationView
              operationState={operationState}
              closeMenu={() => setOperationState(null)}
            />
          )}
        </section>
      </div>
      <footer className="social-footer">
        <span className="social-caption">{t("app.social_caption")}</span>
        <div className="social-links">
          <button
            className="social-button tiktok-button"
            onClick={async () => {
              try {
                await openUrl("https://www.tiktok.com/@xedazu");
              } catch (error) {
                console.error("Failed to open TikTok link", error);
                toast.error(t("app.open_social_failed"));
              }
            }}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M19.6 8.1a7.3 7.3 0 0 1-4.3-1.4v8.1a5.7 5.7 0 1 1-5-5.6v3.2a2.6 2.6 0 1 0 1.9 2.5V2h3.1a4.3 4.3 0 0 0 4.3 4.3v1.8Z" />
            </svg>
            TikTok
            <span className="social-handle">@xedazu</span>
          </button>
          <button
            className="social-button telegram-button"
            onClick={async () => {
              try {
                await openUrl("https://t.me/+WkJo-baL_tkwMWY5");
              } catch (error) {
                console.error("Failed to open Telegram link", error);
                toast.error(t("app.open_social_failed"));
              }
            }}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="m21.4 4.2-3.2 15.1c-.2 1.1-.9 1.4-1.8.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1 9.3-8.4c.4-.4-.1-.6-.6-.2L5.6 12.8.7 11.3c-1.1-.3-1.1-1.1.2-1.6L20.1 2.2c.9-.3 1.7.2 1.3 2Z" />
            </svg>
            Telegram
            <span className="social-handle">{t("app.join_channel")}</span>
          </button>
        </div>
      </footer>
      <Modal
        isOpen={openModal === "certificates"}
        close={() => setOpenModal(null)}
      >
        <Certificates />
      </Modal>
      <Modal isOpen={openModal === "appids"} close={() => setOpenModal(null)}>
        <AppIds />
      </Modal>
      <Modal isOpen={openModal === "pairing"} close={() => setOpenModal(null)}>
        <Pairing />
      </Modal>
      {tourOpen && (
        <div
          className="tour-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeTour();
          }}
        >
          <section
            className="tour-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tour-title"
          >
            <button
              className="tour-close"
              onClick={closeTour}
              aria-label={t("common.dismiss")}
            >
              ×
            </button>
            <div
              className={`tour-visual tour-visual-${tourStep}`}
              aria-hidden="true"
            >
              <span className="tour-orb tour-orb-one" />
              <span className="tour-orb tour-orb-two" />
              <span className="tour-orb tour-orb-three" />
              <div className="tour-device">
                <div className="tour-device-camera" />
                <div className="tour-device-screen">
                  <div className="tour-app-mark">
                    <img src={logo} alt="" />
                  </div>
                  <span className="tour-screen-line tour-screen-line-long" />
                  <span className="tour-screen-line" />
                  <span className="tour-screen-button">
                    {tourStep === 0
                      ? t("app.tour_connect")
                      : tourStep === 1
                        ? t("apple_id.title")
                        : tourStep === 2
                          ? t("device.title")
                          : "SideStore"}
                  </span>
                </div>
              </div>
              <span className="tour-float-card tour-float-card-top">
                <span className="tour-check">✓</span>
                {tourStep < 2
                  ? t("app.tour_ready")
                  : t("app.tour_install")}
              </span>
              <span className="tour-float-card tour-float-card-bottom">
                <span className="tour-sparkle">✦</span>
                {t("app.tour_animated")}
              </span>
            </div>
            <div className="tour-copy" key={tourStep}>
              <span className="tour-eyebrow">
                {t("app.tour_step", { current: tourStep + 1, total: 4 })}
              </span>
              <h2 id="tour-title">{t(`app.tour_title_${tourStep + 1}`)}</h2>
              <p>{t(`app.tour_description_${tourStep + 1}`)}</p>
            </div>
            <div className="tour-progress" aria-hidden="true">
              {[0, 1, 2, 3].map((step) => (
                <span
                  key={step}
                  className={step === tourStep ? "active" : ""}
                />
              ))}
            </div>
            <div className="tour-actions">
              <button className="tour-skip" onClick={closeTour}>
                {t("app.tour_skip")}
              </button>
              <div className="tour-next-actions">
                {tourStep > 0 && (
                  <button
                    key="back"
                    className="tour-back"
                    onClick={() => setTourStep((step) => step - 1)}
                  >
                    {t("app.tour_back")}
                  </button>
                )}
                <button
                  key="next"
                  className="tour-next"
                  onClick={() => {
                    if (tourStep === 3) {
                      closeTour();
                    } else {
                      setTourStep((step) => step + 1);
                    }
                  }}
                  autoFocus
                >
                  {t(tourStep === 3 ? "app.tour_done" : "app.tour_next")}
                  {tourStep < 3 && <span aria-hidden="true">→</span>}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
