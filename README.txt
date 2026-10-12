ESX TO OPEN INTENT CONVERTER, WITH MERAKI UPLOAD
================================================

This tool does two things:

  1. Converts Wi-Fi designs between Ekahau (.esx) and Open Intent (.zip),
     in either direction.
  2. Uploads floor plans, and places access points on them, in a Cisco
     Meraki Dashboard network.

Conversion works in any browser, and you don't need to install anything:

  https://eyserit.github.io/esx-open-intent-converter/

The Meraki upload only works when you run the tool on your own computer,
using the steps below. It runs a small local server, which is the only
part of the tool that talks to Meraki.


WHAT YOU NEED
-------------

  - A Mac, Windows or Linux computer. It has been tested on macOS. Windows
    and Linux should work the same way but haven't been tested.
  - Node.js version 22 or later.
    Get it from https://nodejs.org (choose the "LTS" version).
    To check which version you have, open a terminal and type:

        node --version

    It should print v22 or higher.
  - For the Meraki upload: a Meraki Dashboard API key with access to the
    organisation and network you want to upload to. To create one in
    Dashboard, go to My Profile > API access.

Nothing else is needed. The tool has no packages to install, so you
don't run "npm install".


1. DOWNLOAD
-----------

Option A, without Git:

  1. Go to https://github.com/Eyserit/esx-open-intent-converter
  2. Click the green "Code" button, then "Download ZIP".
  3. Unzip it somewhere you'll find it again, such as your Documents
     folder.

Option B, with Git (makes updating easier later):

    git clone https://github.com/Eyserit/esx-open-intent-converter.git


2. OPEN A TERMINAL IN THE TOOL'S FOLDER
---------------------------------------

  macOS:   Open Terminal, type "cd " (with a space), drag the tool's
           folder onto the Terminal window, then press Return.
  Windows: Open the tool's folder in File Explorer, click the address bar,
           type "cmd" and press Enter.
  Linux:   Right-click in the folder and choose "Open in Terminal".


3. RUN IT
---------

In that terminal, type:

    npm start

You should see:

    Converter running at http://localhost:8000 — press Ctrl+C to stop.

Open http://localhost:8000 in your browser. Leave the terminal open while
you use the tool. Closing it stops the tool.

If port 8000 is already in use, pick another port, for example 8001:

  macOS / Linux:        PORT=8001 npm start
  Windows (cmd):        set PORT=8001 && npm start
  Windows (PowerShell): $env:PORT=8001; npm start

Then open http://localhost:8001 instead.

To stop the tool, click in the terminal and press Ctrl+C.


4. USE IT
---------

Convert a file:

  1. Drop an .esx or Open Intent .zip file on the page, or click
     "Choose file". The tool works out which way to convert by itself.
  2. Click "Download" to save the converted file.

Send floor plans to Meraki (only when you run it locally):

  1. After a conversion, click "Send to Meraki".
  2. Pick your Dashboard region, then paste your API key and click
     Connect.
  3. Pick the organisation, then the wireless network.
  4. Floors: tick the floors to upload. You can change each floor's
     "Name in Meraki". Meraki allows up to 25 characters: letters,
     numbers, spaces, - and _.
     If a floor plan with exactly that name already exists in the network,
     it is updated rather than created again.
  5. Place each floor on the map. Search for the address or paste
     coordinates (e.g. 53.3498, -6.2603), then drag the outline into
     place and rotate it to line up with the building.
     If several floors are the same building, tick "These floors are one
     building: place them together" and place the building once.
  6. Click Upload. The floor plans are uploaded first. Then the design's
     access points are placed on them automatically:
       - Each AP is matched to an AP already in your Meraki network, first
         by name, then (for Ekahau survey projects) by BSSID.
       - An AP that is already on another floor plan is left alone.
       - A results list shows what was placed, moved, skipped or not
         matched.
  7. Click "Open in Dashboard" to check the result, or "Disconnect" to go
     back to your converted file.


YOUR DATA AND YOUR API KEY
--------------------------

  - Files are converted inside your browser. They are never uploaded
    anywhere except to Meraki, and only the floor plans you choose to
    send.
  - Your API key is kept only in the open browser tab, and only while
    you use the Meraki steps. It is not saved anywhere, not logged, and
    is forgotten when you click Disconnect or close the tab.
  - The key goes only from your computer to Meraki, always over HTTPS.
    The local server listens only on your own computer (127.0.0.1), so
    other devices on your network can't reach it.
  - The map uses OpenStreetMap for map images and address search. Those
    services see your IP address and what you search for. They never see
    your API key or your files.
  - Uploaded files can be up to 100 MB.

Tip: use an API key from a Dashboard account that can only see the
organisations you need. If you're trying the tool for the first time,
upload to a test network.


UPDATING
--------

  Downloaded the ZIP:  download it again and replace the old folder.
  Used Git:            in the tool's folder, run:  git pull


TROUBLESHOOTING
---------------

  "npm: command not found" or "'npm' is not recognized"
      Node.js isn't installed, or the terminal was opened before it was
      installed. Install Node.js 22+ and open a new terminal.

  "EADDRINUSE" or "address already in use" when starting
      Another program is using that port. Start on another port (see
      step 3).

  No "Send to Meraki" button after a conversion
      You're on the public website, or the page wasn't opened from
      "npm start". Open the http://localhost address shown in the
      terminal.

  "The local server isn't running — restart it with npm start."
      The terminal running the tool was closed or stopped. Run
      "npm start" again and reload the page.

  "That API key wasn't accepted by Meraki"
      Check the key, and that you picked the right region (Global,
      Canada, China, India or US FedRAMP).

  An access point says "Not matched"
      Its name in the design doesn't match any AP in the network, and it
      had no survey BSSIDs to fall back on. Rename the AP in Dashboard or
      in the design so the names match, then upload again.

  Address search doesn't find the building
      Paste the coordinates instead. In Google Maps, right-click the
      building and click the numbers at the top of the menu to copy them.
