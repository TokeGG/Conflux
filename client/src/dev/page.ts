// One page of the dev panel.
export interface DevPage {
  id: string;
  title: string;
  /** Data pages stop the sim while open, so numbers can be edited calmly (the panel can turn that off). */
  pausesSim?: boolean;
  render(host: HTMLElement): void;
  dispose?(): void;
}
