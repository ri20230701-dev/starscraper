import { SAMPLE_REFERENCE_TIME, SAMPLE_REPOSITORY_PAGE } from './application/fixtures/sampleRepositories';
import { BuildCity } from './application/usecases/BuildCity';
import { GitHubApiClient } from './infrastructure/github/GitHubApiClient';
import { CityPresenter } from './presentation/CityPresenter';
import { CitySwitcher } from './presentation/CitySwitcher';
import { CityHud } from './presentation/hud/CityHud';
import { ThreeCityRenderer } from './presentation/three/ThreeCityRenderer';

// The clock is read here, at the composition root, and travels downward as data. Domain
// and application must not reach for it: the same repositories and the same reference
// instant have to produce the same city every time.
const switcher = new CitySwitcher({
  gateway: new GitHubApiClient(),
  buildCity: new BuildCity(),
  sample: SAMPLE_REPOSITORY_PAGE.repositories,
  sampleReferenceTime: SAMPLE_REFERENCE_TIME,
  now: () => Date.now(),
});

new CityPresenter(switcher, new ThreeCityRenderer(), new CityHud()).start();
