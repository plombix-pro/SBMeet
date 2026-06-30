# SBMeet

SBMeet is a fully functional, high-definition (1080p) WebRTC video conferencing for your rails  application. 
One on One only , fullscreen supported (even in stupid IOS),realtime bandwith and audio level  visualisation .
It support 4/5g to wifi switch , page refresh and ios fullscreen and it comes with basic bootstrap styling .
Minimal implementation , with maximum performance .(Work on basic dyno of heroku)  

## Prerequisites
* **Devise** (Used to ensure room administration as well as reconection or participant maxing)
* **PostgreSQL** (Used natively for both ActiveRecord and ActionCable signaling)
* **Importmap, esbuild, or Webpack** (for Stimulus and ActionCable JS)  
## Installation
Add `gem 'sbmeet'` to your Gemfile and run `bundle install`.
It takes care of styling with bootstrap cdn  if not present
It injects configurations and views files .   

## Usage
Run the installation generator:
`rails generate sbmeet:install`
`rails db:migrate`

Start your server (`bin/dev`) and navigate to `/rooms`.

