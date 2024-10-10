import '../assets/css/Preloader.scss';

// eslint-disable-next-line react/prop-types
const Preloader = ({ smallscreen }) => {
  return (
    <>
      {smallscreen ? (
        <div className="preloader_small">
          <Wrap />
        </div>
      ) : (
        <div className="preloader">
          <Wrap />
        </div>
      )}
    </>
  );

  function Wrap() {
    return (
      <>
        <div className="wrap">
          <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 48 48">
            <g id="Group_382" data-name="Group 382" transform="translate(-2605 -23067)">
              <rect
                id="Rectangle_116"
                data-name="Rectangle 116"
                width="48"
                height="48"
                transform="translate(2605 23067)"
                fill="none"
              />
              <path
                className="animate preloader-top"
                d="M27.775,0a9.608,9.608,0,0,1,9.587,8.953l.022.656h-17.4L25.021,0Z"
                transform="translate(2609.015 23067)"
                fill="#8e50a7"
              />
              <path
                className="animate preloader-mid"
                data-name="Combined-Shapeicon-accelerate"
                d="M37.383,19.231v9.608H10.014l5.035-9.608Z"
                transform="translate(2608.986 23067)"
                fill="#8e50a7"
              />
              <path
                className="animate preloader-bottom"
                data-name="Combined-Shapeicon-accelerate"
                d="M15.836,38.392,10.8,48H0l5.036-9.608Zm21.547,0V48H26.56V38.4Z"
                transform="translate(2609 23067)"
                fill="#8e50a7"
              />
            </g>
          </svg>
        </div>
      </>
    );
  }
};

export { Preloader };
