# `drinks-storage` slides

These are the slides for the [`drinks-storage` project](https://flipdot.org/wiki/Projekte/Drinks%20Storage).

## Preparations
Execute the commands given in the HTML comments within `index.html` load external resources (like videos).

## Displaying
Simply clone the repository and open `index.html` in a browser of your choice.

## Speaker notes
Install the dependencies and start the notes server, then open the printed URL. The current slide is mirrored on a separate notes page in a second browser window.

```sh
npm install
npm start
```

The multiplex server for driving the slides from another machine is started with `node plugin/multiplex/index.js`.

## Development
`npm test` runs a smoke test that boots both servers and exercises the HTTP and socket.io endpoints. The same checks run in CI on every push and pull request.
