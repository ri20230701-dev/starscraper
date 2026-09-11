import { CreateDummyCity } from './application/usecases/CreateDummyCity';
import { CityPresenter } from './presentation/CityPresenter';
import { CityHud } from './presentation/hud/CityHud';
import { ThreeCityRenderer } from './presentation/three/ThreeCityRenderer';

const presenter = new CityPresenter(new CreateDummyCity(), new ThreeCityRenderer(), new CityHud());
presenter.start();
